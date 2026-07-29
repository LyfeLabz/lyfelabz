// Google Classroom transport seam. Sprint 23A preparation slice
// (SPRINT_23_ARCHITECTURE_REVIEW.md §6). Activated in Sprint 23B with a
// real fetch-based HTTPS production binding
// (`createHttpsGoogleClassroomTransport`).
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
// - The default `getTransport()` still throws
//   `lms.googleClassroomTransportUnbound` when no binding has been
//   installed. Production callables install the fetch-based binding
//   lazily through `ensureGoogleClassroomProductionBindings` in
//   `config-firebase.ts`; tests install a fixture transport through
//   `setGoogleClassroomTransport`. The `withGoogleClassroomTransport`
//   helper installs and restores the prior binding for a single scoped
//   block so a failing test cannot leak state into the next test.

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

// Minimum shape of https://classroom.googleapis.com/v1/userProfiles/me.
// Read once at completeOAuth time so the vendor-neutral grant record can
// carry `upstreamAccountIdentifier` (Amendment §6.1 personal-account
// misconnection mitigation). Every classroom scope grants access to the
// caller's own profile, so no additional scope is required.
export type GoogleClassroomUserProfileMeRequest = {
  readonly accessToken: string;
};

export type GoogleClassroomUserProfileResource = {
  readonly id: string;
  readonly emailAddress?: string;
  readonly name?: {
    readonly fullName?: string;
    readonly givenName?: string;
    readonly familyName?: string;
  };
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

  getUserProfileMe(
    input: GoogleClassroomUserProfileMeRequest,
  ): Promise<GoogleClassroomUserProfileResource>;

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
  getUserProfileMe(): never {
    this.unbound("getUserProfileMe");
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

// Predicate used by the production installer in `config-firebase.ts` so
// production activation is idempotent and never overwrites a fixture
// binding a test installed. Compares identity against the sentinel
// unbound transport; any other value is a "bound" binding.
export function isGoogleClassroomTransportBound(): boolean {
  return ACTIVE_TRANSPORT !== UNBOUND_TRANSPORT;
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

// -------------------- Production HTTPS binding --------------------
//
// Sprint 23B activation. Fetch-based implementation of
// `GoogleClassroomTransport` against Google's public OAuth 2.0 and
// Classroom REST v1 endpoints. Every request is a plain HTTPS call
// through Node 20's global `fetch`; no vendor SDK is required and no
// runtime state persists across calls.
//
// Error translation invariants (SPRINT 23B specification §UPSTREAM
// ERROR HANDLING):
//
// - Successful (2xx) responses are parsed as JSON and returned to the
//   caller in the REST v1 shape the transport interface documents.
// - Non-2xx responses are translated into `GoogleClassroomHttpsError`
//   (a plain Error subclass) so the adapter's boundary translator can
//   coerce them into stable `PlatformError` codes without pulling any
//   HTTP concern into the vendor-neutral core.
// - No response body is logged. Only the status code, the endpoint
//   identifier, and the upstream error shape's `error` field are
//   surfaced. Token material carried in the request never leaves the
//   trust boundary because the transport does not log the request body.

export const GOOGLE_OAUTH_TOKEN_ENDPOINT =
  "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_REVOKE_ENDPOINT =
  "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CLASSROOM_API_ROOT = "https://classroom.googleapis.com/v1";

// Plain error subclass raised on any non-2xx upstream response. The
// adapter is responsible for translating this into a `PlatformError`;
// this class is intentionally provider-language so the transport
// surface stays vendor-native (PDR-020f).
export class GoogleClassroomHttpsError extends Error {
  readonly status: number;
  readonly upstreamCode: string;
  readonly endpoint: string;

  constructor(
    status: number,
    upstreamCode: string,
    endpoint: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleClassroomHttpsError";
    this.status = status;
    this.upstreamCode = upstreamCode;
    this.endpoint = endpoint;
  }
}

// Injected boundary for the production binding so tests can stub the
// network transport with an in-memory fetcher when needed. Defaults to
// the global `fetch` supplied by Node 20.
export type HttpsFetch = (
  input: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: string;
  },
) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  text(): Promise<string>;
}>;

export type HttpsGoogleClassroomConfigResolver = () => {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type HttpsGoogleClassroomTransportOptions = {
  readonly resolveConfig: HttpsGoogleClassroomConfigResolver;
  readonly fetchImpl?: HttpsFetch;
};

function parseJsonSafely(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function extractUpstreamCode(parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    if (typeof p.error === "string") return p.error;
    if (p.error && typeof p.error === "object") {
      const e = p.error as Record<string, unknown>;
      if (typeof e.status === "string") return e.status;
      if (typeof e.message === "string") return e.message;
    }
  }
  return "unknown";
}

async function callUpstream(
  fetchImpl: HttpsFetch,
  endpoint: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: string;
  },
): Promise<unknown> {
  const response = await fetchImpl(endpoint, init);
  const body = await response.text();
  if (!response.ok) {
    const parsed = parseJsonSafely(body);
    throw new GoogleClassroomHttpsError(
      response.status,
      extractUpstreamCode(parsed),
      endpoint,
      `Google upstream ${endpoint} responded ${response.status}`,
    );
  }
  if (body.length === 0) return {};
  const parsed = parseJsonSafely(body);
  if (parsed === undefined) {
    throw new GoogleClassroomHttpsError(
      response.status,
      "MALFORMED",
      endpoint,
      `Google upstream ${endpoint} returned a non-JSON body`,
    );
  }
  return parsed;
}

function urlEncodeFormBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    )
    .join("&");
}

function classroomUrl(path: string, query?: Record<string, string>): string {
  const base = `${GOOGLE_CLASSROOM_API_ROOT}${path}`;
  if (!query) return base;
  const q = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q.length > 0 ? `${base}?${q}` : base;
}

export function createHttpsGoogleClassroomTransport(
  options: HttpsGoogleClassroomTransportOptions,
): GoogleClassroomTransport {
  const fetchImpl: HttpsFetch =
    options.fetchImpl ??
    (async (input, init) => {
      // Route through global fetch (Node 20). Cast keeps the transport
      // typing stable regardless of DOM lib presence.
      const g = globalThis as unknown as {
        fetch: (
          i: string,
          init: { method: string; headers?: Record<string, string>; body?: string },
        ) => Promise<{
          status: number;
          ok: boolean;
          text(): Promise<string>;
        }>;
      };
      return g.fetch(input, init);
    });

  return {
    async exchangeAuthorizationCode(input) {
      const { clientId, clientSecret } = options.resolveConfig();
      const body = urlEncodeFormBody({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      });
      const parsed = (await callUpstream(fetchImpl, GOOGLE_OAUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })) as GoogleAuthorizationCodeExchangeResponse;
      return parsed;
    },

    async refreshAccessToken(input) {
      const { clientId, clientSecret } = options.resolveConfig();
      const body = urlEncodeFormBody({
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const parsed = (await callUpstream(fetchImpl, GOOGLE_OAUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })) as GoogleAccessTokenRefreshResponse;
      return parsed;
    },

    async revokeToken(input) {
      const body = urlEncodeFormBody({ token: input.token });
      await callUpstream(fetchImpl, GOOGLE_OAUTH_REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    },

    async getUserProfileMe(input) {
      const parsed = (await callUpstream(
        fetchImpl,
        classroomUrl("/userProfiles/me"),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.accessToken}` },
        },
      )) as GoogleClassroomUserProfileResource;
      return parsed;
    },

    async listTeacherCourses(input) {
      const parsed = (await callUpstream(
        fetchImpl,
        classroomUrl("/courses", {
          teacherId: "me",
          courseStates: "ACTIVE",
          ...(input.pageToken ? { pageToken: input.pageToken } : {}),
          ...(input.pageSize !== undefined
            ? { pageSize: String(input.pageSize) }
            : {}),
        }),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.accessToken}` },
        },
      )) as GoogleClassroomCourseListResponse;
      return parsed;
    },

    async fetchCourse(input) {
      const parsed = (await callUpstream(
        fetchImpl,
        classroomUrl(`/courses/${encodeURIComponent(input.courseId)}`),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.accessToken}` },
        },
      )) as GoogleClassroomCourseResource;
      return parsed;
    },

    async listCourseStudents(input) {
      const parsed = (await callUpstream(
        fetchImpl,
        classroomUrl(
          `/courses/${encodeURIComponent(input.courseId)}/students`,
          {
            ...(input.pageToken ? { pageToken: input.pageToken } : {}),
            ...(input.pageSize !== undefined
              ? { pageSize: String(input.pageSize) }
              : {}),
          },
        ),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.accessToken}` },
        },
      )) as GoogleClassroomStudentListResponse;
      return parsed;
    },

    async listCourseTopics(input) {
      const parsed = (await callUpstream(
        fetchImpl,
        classroomUrl(
          `/courses/${encodeURIComponent(input.courseId)}/topics`,
          {
            ...(input.pageToken ? { pageToken: input.pageToken } : {}),
            ...(input.pageSize !== undefined
              ? { pageSize: String(input.pageSize) }
              : {}),
          },
        ),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${input.accessToken}` },
        },
      )) as GoogleClassroomTopicListResponse;
      return parsed;
    },

    async createCourseWork(input) {
      const bodyObj: Record<string, unknown> = {
        title: input.title,
        state: "PUBLISHED",
        workType: "ASSIGNMENT",
        materials: [{ link: { url: input.link } }],
      };
      if (input.description !== undefined) bodyObj.description = input.description;
      if (input.topicId !== undefined) bodyObj.topicId = input.topicId;
      const parsed = (await callUpstream(
        fetchImpl,
        classroomUrl(
          `/courses/${encodeURIComponent(input.courseId)}/courseWork`,
        ),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(bodyObj),
        },
      )) as GoogleClassroomCourseWorkResource;
      return parsed;
    },
  };
}
