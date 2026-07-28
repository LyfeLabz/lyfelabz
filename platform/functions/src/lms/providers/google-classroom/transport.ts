// Google Classroom transport seam. Sprint 23A preparation slice
// (SPRINT_23_ARCHITECTURE_REVIEW.md §6).
//
// Scope and invariants:
//
// - This module is package-local to `providers/google-classroom`. It is
//   never imported from the vendor-neutral LMS core (`providers/provider.ts`,
//   `providers/registry.ts`, `tokens/token-store.ts`, any callable). The
//   vendor-neutral core sees only `LmsProviderAdapter` (PDR-020f).
//
// - Every Google-specific REST request and response shape lives inside
//   this file. Callers of this module trade in Google Classroom REST v1
//   payload shapes; the adapter (`adapter.ts`) is the single boundary
//   that translates those into the vendor-neutral provider types.
//
// - Sprint 23A ships no default binding. The default `getTransport()`
//   throws `lms.googleClassroomTransportUnbound` if any production code
//   path resolves it. Production adapter methods still short-circuit at
//   `lms.providerNotYetOperational` in 23A, so this throw is a defense
//   in depth: it proves at test time that no seam has been accidentally
//   activated. Sprint 23B replaces the default binding with a real
//   HTTPS transport.
//
// - Tests install a fixture transport through `setGoogleClassroomTransport`.
//   The `withGoogleClassroomTransport` helper installs and restores the
//   prior binding for a single scoped block so a failing test cannot
//   leak state into the next test.

import { PlatformError } from "../../../shared";

// -------------------- REST v1 payload shapes --------------------
//
// These types describe the narrow subset of Google Classroom REST v1
// payloads the adapter actually reads or writes. They intentionally do
// not model every optional field the upstream returns; the adapter
// consumes only the fields recorded here.

export type GoogleAuthorizationCodeExchangeRequest = {
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier?: string;
};

export type GoogleAuthorizationCodeExchangeResponse = {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope: string;
  readonly token_type: string;
};

export type GoogleAccessTokenRefreshRequest = {
  readonly refreshToken: string;
};

export type GoogleAccessTokenRefreshResponse = {
  readonly access_token: string;
  readonly expires_in?: number;
  readonly scope: string;
  readonly token_type: string;
};

export type GoogleTokenRevokeRequest = {
  readonly token: string;
};

export type GoogleClassroomCourseListRequest = {
  readonly accessToken: string;
  readonly pageToken?: string;
  readonly pageSize?: number;
};

export type GoogleClassroomCourseResource = {
  readonly id: string;
  readonly name: string;
  readonly section?: string;
  readonly ownerId: string;
  readonly courseState?:
    | "COURSE_STATE_UNSPECIFIED"
    | "ACTIVE"
    | "ARCHIVED"
    | "PROVISIONED"
    | "DECLINED"
    | "SUSPENDED";
};

export type GoogleClassroomCourseListResponse = {
  readonly courses?: readonly GoogleClassroomCourseResource[];
  readonly nextPageToken?: string;
};

export type GoogleClassroomCourseFetchRequest = {
  readonly accessToken: string;
  readonly courseId: string;
};

export type GoogleClassroomStudentListRequest = {
  readonly accessToken: string;
  readonly courseId: string;
  readonly pageToken?: string;
  readonly pageSize?: number;
};

export type GoogleClassroomStudentResource = {
  readonly userId: string;
  readonly profile: {
    readonly id: string;
    readonly name?: {
      readonly fullName?: string;
      readonly givenName?: string;
      readonly familyName?: string;
    };
  };
};

export type GoogleClassroomStudentListResponse = {
  readonly students?: readonly GoogleClassroomStudentResource[];
  readonly nextPageToken?: string;
};

export type GoogleClassroomTopicListRequest = {
  readonly accessToken: string;
  readonly courseId: string;
  readonly pageToken?: string;
  readonly pageSize?: number;
};

export type GoogleClassroomTopicResource = {
  readonly topicId: string;
  readonly name: string;
};

export type GoogleClassroomTopicListResponse = {
  readonly topic?: readonly GoogleClassroomTopicResource[];
  readonly nextPageToken?: string;
};

export type GoogleClassroomCourseWorkCreateRequest = {
  readonly accessToken: string;
  readonly courseId: string;
  readonly title: string;
  readonly description?: string;
  readonly link: string;
  readonly topicId?: string;
};

export type GoogleClassroomCourseWorkResource = {
  readonly id: string;
  readonly alternateLink?: string;
};

// -------------------- Transport interface --------------------

export interface GoogleClassroomTransport {
  exchangeAuthorizationCode(
    input: GoogleAuthorizationCodeExchangeRequest,
  ): Promise<GoogleAuthorizationCodeExchangeResponse>;

  refreshAccessToken(
    input: GoogleAccessTokenRefreshRequest,
  ): Promise<GoogleAccessTokenRefreshResponse>;

  revokeToken(input: GoogleTokenRevokeRequest): Promise<void>;

  listTeacherCourses(
    input: GoogleClassroomCourseListRequest,
  ): Promise<GoogleClassroomCourseListResponse>;

  fetchCourse(
    input: GoogleClassroomCourseFetchRequest,
  ): Promise<GoogleClassroomCourseResource>;

  listCourseStudents(
    input: GoogleClassroomStudentListRequest,
  ): Promise<GoogleClassroomStudentListResponse>;

  listCourseTopics(
    input: GoogleClassroomTopicListRequest,
  ): Promise<GoogleClassroomTopicListResponse>;

  createCourseWork(
    input: GoogleClassroomCourseWorkCreateRequest,
  ): Promise<GoogleClassroomCourseWorkResource>;
}

// -------------------- Binding --------------------

class UnboundGoogleClassroomTransport implements GoogleClassroomTransport {
  private unbound(op: string): never {
    throw new PlatformError(
      "lms.googleClassroomTransportUnbound",
      `Google Classroom transport is not bound for ${op}. Sprint 23A ships no default binding; production activation is a Sprint 23B obligation. Tests must install a fixture transport with setGoogleClassroomTransport() or withGoogleClassroomTransport().`,
    );
  }

  exchangeAuthorizationCode(): never {
    this.unbound("exchangeAuthorizationCode");
  }
  refreshAccessToken(): never {
    this.unbound("refreshAccessToken");
  }
  revokeToken(): never {
    this.unbound("revokeToken");
  }
  listTeacherCourses(): never {
    this.unbound("listTeacherCourses");
  }
  fetchCourse(): never {
    this.unbound("fetchCourse");
  }
  listCourseStudents(): never {
    this.unbound("listCourseStudents");
  }
  listCourseTopics(): never {
    this.unbound("listCourseTopics");
  }
  createCourseWork(): never {
    this.unbound("createCourseWork");
  }
}

const UNBOUND_TRANSPORT: GoogleClassroomTransport =
  new UnboundGoogleClassroomTransport();

let ACTIVE_TRANSPORT: GoogleClassroomTransport = UNBOUND_TRANSPORT;

export function getGoogleClassroomTransport(): GoogleClassroomTransport {
  return ACTIVE_TRANSPORT;
}

export function setGoogleClassroomTransport(
  transport: GoogleClassroomTransport,
): void {
  ACTIVE_TRANSPORT = transport;
}

// Scoped installation helper. Restores the prior binding after `fn`
// resolves or rejects. Tests use this to guarantee cleanup even when
// an assertion throws.
export async function withGoogleClassroomTransport<T>(
  transport: GoogleClassroomTransport,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = ACTIVE_TRANSPORT;
  ACTIVE_TRANSPORT = transport;
  try {
    return await fn();
  } finally {
    ACTIVE_TRANSPORT = previous;
  }
}

// Test-only reset. Used by afterEach to guarantee state cleanup.
export function resetGoogleClassroomTransportForTests(): void {
  ACTIVE_TRANSPORT = UNBOUND_TRANSPORT;
}
