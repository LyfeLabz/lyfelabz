import type { LmsProviderId } from "../../shared";
import type { LmsOAuthStateIntent } from "../oauth-state/state-store";

// Vendor-neutral LMS provider interface per LMS_INTEGRATION_ARCHITECTURE.md
// §2 ("vendor-neutral core, vendor-specific edges") and PDR-020f
// (provider neutrality is permanent). Every provider-specific concern
// lives inside its adapter implementation; every provider-neutral concern
// (callable signatures, mirror record shape, audit vocabulary, security
// rules) lives inside the core and speaks only in this interface.
//
// The interface exposes the operations required by the initial scope
// (PDR-020c: connection lifecycle, classroom discovery, class import),
// the assignment publication surface authorized by the Sprint 8D
// specification as an explicit subsequent-sprint expansion under the
// PDR-020c "Future Reconsideration" clause, and the roster-read
// operation authorized by the Sprint 23C specification. Roster reading
// is now part of the certified vendor-neutral provider boundary; the
// provider-neutral Sprint 23C synchronization engine consumes it to
// reconcile a linked upstream class with a LyfeLabz class's
// enrollments. Every other previously excluded capability (grade sync,
// announcements, materials, coursework mutation beyond publication,
// ...) remains absent by design; adding any of them requires its own
// sprint specification.

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

// The result of exchanging stored refresh material for a fresh access
// token (Sprint 25 credential-refresh lifecycle, PDR-030h). A refresh is
// credential maintenance, NOT a new authorization event: it never widens
// scope, never mints OAuth state, and never changes the upstream account
// identity. It renews only the access token and its expiry.
//
// `refreshToken` and `scopes` are present ONLY when the provider returns
// authoritative replacements. The refresh orchestration
// (`resolveLiveCredential`) preserves the existing refresh token and
// existing scopes verbatim whenever these are omitted, so a refresh can
// never lose offline access and can never regress the granted scope set.
// The Google Classroom `refresh_token` grant omits both fields on every
// ordinary refresh, so both are normally absent.
export type LmsCredentialRefresh = {
  readonly accessToken: string;
  readonly expiresInSeconds?: number;
  readonly refreshToken?: string;
  readonly scopes?: readonly string[];
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

// -------------------- Roster --------------------

// The minimum roster-member identity the vendor-neutral roster surface
// exposes. The set is deliberately narrow per the Sprint 23C
// specification: only the opaque upstream account identifier that the
// certified external identity bridge maps to a LyfeLabz Firebase UID.
// No email, no display name, no profile photo, no course role, no
// enrollment status, no school metadata, and no Google-shaped
// response fields leak through this boundary. The Sprint 23C
// synchronization engine consumes this shape without ever holding
// upstream profile data.
//
// `providerAccountId` is the opaque, stable upstream account identifier
// returned by the LMS roster. It is not a LyfeLabz Firebase UID and it
// is not an email address; it is the value passed into
// `resolveActiveExternalIdentity({ providerId: "google.com",
// providerAccountId })`. For Google Classroom this value is the
// Classroom student account identifier proven equivalent in Sprint
// 23C-I to the Firebase Auth `google.com` provider UID. The LMS
// provider namespace (this file's `LmsProviderId`) and the external
// identity provider namespace (`ExternalIdentityProviderId`, currently
// `"google.com"`) are distinct namespaces and must not be conflated.
export type LmsRosterStudent = {
  readonly providerAccountId: string;
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
  // §10.3.8 of the operational readiness section. When `intent` is
  // "publication", the adapter additionally requests the publication
  // capability scope set via incremental consent (PDR-030c).
  beginOAuth(input: {
    readonly teacherId: string;
    readonly redirectUri: string;
    readonly intent?: LmsOAuthStateIntent;
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

  // Exchange stored refresh material for a fresh access token. Called by
  // the vendor-neutral credential resolver (`resolveLiveCredential`) when a
  // stored access token is expired or within the refresh skew of expiry
  // (Sprint 25 credential-refresh lifecycle, PDR-030h). The adapter maps
  // its provider-specific refresh endpoint into the vendor-neutral
  // `LmsCredentialRefresh`; it never widens scope and never mints OAuth
  // state. Errors are translated to the same stable vendor-neutral
  // `PlatformError` vocabulary every other adapter operation uses, so the
  // resolver can distinguish an unrecoverable credential (invalid_grant ->
  // lms.upstreamAuthorizationFailed) from a transient upstream failure.
  refreshCredential(input: {
    readonly refreshToken: string;
  }): Promise<LmsCredentialRefresh>;

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

  // List the complete normalized roster for one linked upstream class.
  // Authorized by the Sprint 23C specification. Pagination is entirely
  // an adapter concern: this method returns one complete normalized
  // roster or rejects the operation. Page tokens, iterators,
  // generators, and any provider-specific response shapes never
  // escape the adapter. The synchronization engine never receives a
  // partial roster represented as successful; a later-page failure
  // after earlier pages succeeded rejects the entire operation.
  // Duplicate provider account identifiers are collapsed
  // deterministically to one entry per identifier before returning.
  listClassRoster(input: {
    readonly accessToken: string;
    readonly lmsClassId: string;
  }): Promise<readonly LmsRosterStudent[]>;

  // Publish a LyfeLabz-authored assignment to the upstream class as a
  // pointer to the LyfeLabz surface where the work happens
  // (LMS_INTEGRATION_ARCHITECTURE.md §7.3). The LyfeLabz assignment
  // record is authoritative; the LMS-side record is a side effect per
  // PDR-019d.
  publishAssignment(
    input: LmsPublishAssignmentInput,
  ): Promise<LmsPublishedAssignment>;
}
