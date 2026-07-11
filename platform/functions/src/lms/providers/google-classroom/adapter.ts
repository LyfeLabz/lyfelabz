import { PlatformError, type LmsProviderId } from "../../../shared";
import type {
  LmsDiscoveredClass,
  LmsOAuthAuthorizationRequest,
  LmsOAuthGrant,
  LmsProviderAdapter,
  LmsPublishedAssignment,
  LmsTopic,
} from "../provider";

// Google Classroom adapter placeholder per PDR-020a and PDR-020f. The
// initial scope authorized by PDR-020c requires the vendor-neutral core
// (provider abstraction, registry, connection lifecycle scaffolding,
// classroom discovery/import scaffolding) but does NOT authorize the
// live Google API integration; the operational OAuth client, secret
// manager wiring, and API emulator harness named in
// LMS_INTEGRATION_ARCHITECTURE.md §10.3 are prerequisites that the sprint
// specification records as "operational, in progress." This adapter
// therefore implements the interface with well-defined `PlatformError`
// responses until those operational artifacts land in a subsequent
// sprint. The important architectural property is that no Google
// specific concern escapes this file (PDR-020f): the core knows only
// `LmsProviderAdapter`, and the adapter knows only Google Classroom.

const GOOGLE_CLASSROOM_PROVIDER_ID: LmsProviderId = "googleClassroom";
const GOOGLE_CLASSROOM_DISPLAY_NAME = "Google Classroom";

// The minimum-required scopes for the initial scope per
// LMS_INTEGRATION_ARCHITECTURE.md §5.2 and §10.3.8: list the teacher's
// classes and inspect a class's roster. Scopes for excluded capabilities
// (roster synchronization, publication, refresh) are not requested here;
// they are added by the sprint that owns the workflow requiring them.
export const GOOGLE_CLASSROOM_INITIAL_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
];

// Additional OAuth scopes required by the Sprint 8D assignment
// publication surface. The scopes are requested incrementally per §5.2
// of the architecture; they are additive to the initial scope and are
// documented separately so a future contributor can see exactly which
// sprint each scope belongs to. The teacher sees a scope-scoped consent
// prompt at the moment the publication workflow requires it.
export const GOOGLE_CLASSROOM_PUBLICATION_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/classroom.coursework.me",
  "https://www.googleapis.com/auth/classroom.topics.readonly",
];

function notYetOperational(op: string): PlatformError {
  return new PlatformError(
    "lms.providerNotYetOperational",
    `Google Classroom ${op} requires operational OAuth provisioning (LMS_INTEGRATION_ARCHITECTURE.md §10.3.1). The provider adapter is scaffolded but the live upstream is not yet wired.`,
  );
}

export const googleClassroomAdapter: LmsProviderAdapter = {
  providerId: GOOGLE_CLASSROOM_PROVIDER_ID,
  displayName: GOOGLE_CLASSROOM_DISPLAY_NAME,

  beginOAuth(): Promise<LmsOAuthAuthorizationRequest> {
    return Promise.reject(notYetOperational("OAuth begin"));
  },

  completeOAuth(): Promise<LmsOAuthGrant> {
    return Promise.reject(notYetOperational("OAuth complete"));
  },

  revokeGrant(): Promise<void> {
    return Promise.reject(notYetOperational("grant revocation"));
  },

  listTeacherClasses(): Promise<readonly LmsDiscoveredClass[]> {
    return Promise.reject(notYetOperational("classroom discovery"));
  },

  fetchClass(): Promise<LmsDiscoveredClass> {
    return Promise.reject(notYetOperational("classroom fetch"));
  },

  listClassTopics(): Promise<readonly LmsTopic[]> {
    return Promise.reject(notYetOperational("topic listing"));
  },

  publishAssignment(): Promise<LmsPublishedAssignment> {
    return Promise.reject(notYetOperational("assignment publication"));
  },
};
