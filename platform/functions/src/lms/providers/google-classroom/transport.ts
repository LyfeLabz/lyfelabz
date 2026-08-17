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

import { PlatformError, log } from "../../../shared";

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
  // Optional abort signal (Sprint 25 Phase 1, §2.3 Correction 3). The
  // adapter supplies an AbortController-backed signal so the coursework
  // POST is genuinely cancelled when the adapter-level timeout fires,
  // rather than left running against the Cloud Functions deadline. This
  // is an additive optional field; every other transport operation and
  // every existing caller is unaffected.
  readonly signal?: AbortSignal;
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
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  text(): Promise<string>;
  // Read a single named response header, or null when absent. Optional so
  // existing in-memory fixtures need not implement it. The production
  // global-fetch binding delegates to `Response.headers.get`. This is the
  // minimum surface needed to read `WWW-Authenticate` for the Sprint 25 B9
  // certification diagnostic; it deliberately exposes one named header at a
  // time rather than copying all response headers into application state.
  header?(name: string): string | null;
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

// Google's google.rpc.ErrorInfo carries a machine-readable `reason` inside
// error.details[]. For an OAuth scope shortfall the top-level error.status
// is the generic "PERMISSION_DENIED"; only the nested reason
// "ACCESS_TOKEN_SCOPE_INSUFFICIENT" distinguishes an insufficient-scope
// denial from an ordinary permission denial. The scan is restricted to
// these two exact scope markers ("ACCESS_TOKEN_SCOPE_INSUFFICIENT" is the
// current real-Google spelling; "INSUFFICIENT_SCOPE" is the legacy /
// fixture spelling) so an ordinary PERMISSION_DENIED is never reclassified
// as insufficient scope.
const SCOPE_INSUFFICIENT_REASONS: ReadonlySet<string> = new Set([
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "INSUFFICIENT_SCOPE",
]);

function extractScopeInsufficientReason(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined;
  for (const entry of details) {
    if (entry && typeof entry === "object") {
      const reason = (entry as Record<string, unknown>).reason;
      if (
        typeof reason === "string" &&
        SCOPE_INSUFFICIENT_REASONS.has(reason)
      ) {
        return reason;
      }
    }
  }
  return undefined;
}

function extractUpstreamCode(parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    if (typeof p.error === "string") return p.error;
    if (p.error && typeof p.error === "object") {
      const e = p.error as Record<string, unknown>;
      // Prefer the structured scope-insufficient reason over the generic
      // status so the adapter's boundary translator can classify insufficient
      // scope. Only the two exact scope markers are surfaced here; every
      // other error still reports its status (or message) unchanged.
      const scopeReason = extractScopeInsufficientReason(e.details);
      if (scopeReason !== undefined) return scopeReason;
      if (typeof e.status === "string") return e.status;
      if (typeof e.message === "string") return e.message;
    }
  }
  return "unknown";
}

// ============================================================================
// TEMPORARY - Sprint 25 B9 certification diagnostic. REMOVE (or convert into
// minimal permanent observability) before Sprint 25 closeout.
//
// Retention (2026-08-16, PDR-030g): this diagnostic has already captured the
// stale-credential 401 (`invalid_token`) and the real 403
// `ACCESS_TOKEN_SCOPE_INSUFFICIENT` under the wrong `classroom.coursework.me`
// scope. It is intentionally RETAINED through ONE more real-Google B9 retest
// under the corrected `classroom.coursework.students` scope, where it must
// show NO scope-denial response on the publication path. Only after that clean
// retest is it removed or converted to minimal permanent observability. Do not
// broaden its logged fields.
//
// Purpose: capture a SANITIZED, non-identifying summary of a non-2xx Google
// upstream response so ONE real-Google B9 retry reveals exactly how Google
// signals an insufficient-scope denial (HTTP 401 vs 403, error.status,
// error.details[].reason, and the WWW-Authenticate auth error token). This
// block does NOT change classification: `extractUpstreamCode` and the value
// thrown from `callUpstream` are untouched, so the B9 retry reproduces the
// current failure while emitting the missing evidence.
//
// Sanitization invariants (never logged): access/refresh tokens,
// Authorization or any request/response header set, OAuth codes, client
// secrets, full request/response bodies, full error messages, Google account
// email or user id, course id, coursework id, and any student/teacher PII.
// Only bounded categorical enum tokens, numeric HTTP status, booleans, and a
// route with every dynamic id segment replaced by "{id}" are emitted.

// google.rpc canonical status codes and google.rpc.ErrorInfo reasons are
// UPPER_SNAKE_CASE enum tokens (<=63 chars). Restricting logged values to this
// shape guarantees no free-form identifier is ever emitted through these
// fields.
const DIAGNOSTIC_ENUM_TOKEN = /^[A-Z][A-Z0-9_]{0,62}$/;

// Path segments that are static keywords in the OAuth token/revoke endpoints
// and the Classroom REST v1 routes. Every other segment is a resource id
// (course id, coursework id, ...) and is replaced with "{id}" before logging.
const DIAGNOSTIC_STATIC_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "v1",
  "courses",
  "courseWork",
  "students",
  "topics",
  "userProfiles",
  "me",
  "token",
  "revoke",
]);

// A small allowlist of Google's fixed, non-identifying error messages, mapped
// to a categorical label. Any message not on this list is never logged (only a
// presence boolean is), because arbitrary messages can embed identifiers.
const DIAGNOSTIC_KNOWN_MESSAGES: ReadonlyMap<string, string> = new Map([
  [
    "Request had insufficient authentication scopes.",
    "insufficientAuthenticationScopes",
  ],
  ["The caller does not have permission.", "callerLacksPermission"],
  ["Invalid Credentials", "invalidCredentials"],
  ["Login Required.", "loginRequired"],
]);

function diagnosticRoute(endpoint: string): string {
  let path: string;
  try {
    path = new URL(endpoint).pathname;
  } catch {
    path = endpoint.split("?")[0] ?? endpoint;
  }
  return path
    .split("/")
    .map((seg) =>
      seg.length === 0 || DIAGNOSTIC_STATIC_PATH_SEGMENTS.has(seg)
        ? seg
        : "{id}",
    )
    .join("/");
}

function diagnosticDetailReasons(details: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(details)) return out;
  for (const entry of details) {
    if (entry && typeof entry === "object") {
      const reason = (entry as Record<string, unknown>).reason;
      if (typeof reason === "string" && DIAGNOSTIC_ENUM_TOKEN.test(reason)) {
        out.push(reason);
      }
    }
  }
  return out;
}

// Parse only the authentication error token and the presence of an
// error_description from a WWW-Authenticate challenge. The error token is a
// fixed categorical value (e.g. insufficient_scope, invalid_token); the
// description is reduced to a presence boolean because it can be free-form.
function diagnosticAuthChallenge(header: string | null | undefined): {
  authError?: string;
  authErrorDescriptionPresent?: boolean;
} {
  if (typeof header !== "string" || header.length === 0) return {};
  const out: { authError?: string; authErrorDescriptionPresent?: boolean } = {};
  const errorMatch = /\berror\s*=\s*"?([a-zA-Z][a-zA-Z0-9_]{0,62})"?/.exec(
    header,
  );
  if (errorMatch && errorMatch[1]) out.authError = errorMatch[1];
  const descMatch = /\berror_description\s*=\s*"([^"]*)"/.exec(header);
  if (descMatch) out.authErrorDescriptionPresent = descMatch[1].length > 0;
  return out;
}

function emitUpstreamDiagnostic(
  response: { readonly status: number; header?(name: string): string | null },
  endpoint: string,
  parsed: unknown,
): void {
  try {
    const fields: Record<string, unknown> = {
      temporary: true,
      certification: "sprint25-b9",
      httpStatus: response.status,
      route: diagnosticRoute(endpoint),
    };
    if (parsed && typeof parsed === "object") {
      const err = (parsed as Record<string, unknown>).error;
      if (typeof err === "string") {
        // OAuth token/revoke endpoints report a lowercase_underscore token.
        if (/^[a-z][a-z0-9_]{0,62}$/.test(err)) {
          fields.oauthError = err;
        } else {
          fields.oauthErrorPresent = true;
        }
      } else if (err && typeof err === "object") {
        const e = err as Record<string, unknown>;
        if (typeof e.status === "string" && DIAGNOSTIC_ENUM_TOKEN.test(e.status)) {
          fields.errorStatus = e.status;
        }
        if (typeof e.code === "number") fields.errorCode = e.code;
        const reasons = diagnosticDetailReasons(e.details);
        if (reasons.length > 0) fields.detailReasons = reasons;
        fields.errorMessagePresent =
          typeof e.message === "string" && e.message.length > 0;
        if (typeof e.message === "string") {
          const category = DIAGNOSTIC_KNOWN_MESSAGES.get(e.message);
          if (category !== undefined) fields.errorMessageCategory = category;
        }
      }
    } else {
      fields.bodyParsed = false;
    }
    const challenge = diagnosticAuthChallenge(
      typeof response.header === "function"
        ? response.header("WWW-Authenticate")
        : undefined,
    );
    fields.wwwAuthenticatePresent =
      challenge.authError !== undefined ||
      challenge.authErrorDescriptionPresent !== undefined;
    if (challenge.authError !== undefined) {
      fields.wwwAuthenticateError = challenge.authError;
    }
    if (challenge.authErrorDescriptionPresent !== undefined) {
      fields.wwwAuthenticateErrorDescriptionPresent =
        challenge.authErrorDescriptionPresent;
    }
    log.warn("lms.googleClassroomUpstreamDiagnostic", fields);
  } catch {
    // A diagnostic must never affect control flow, the thrown error, or
    // classification. Any failure building or emitting it is swallowed.
  }
}
// ============================================================================

async function callUpstream(
  fetchImpl: HttpsFetch,
  endpoint: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
): Promise<unknown> {
  const response = await fetchImpl(endpoint, init);
  const body = await response.text();
  if (!response.ok) {
    const parsed = parseJsonSafely(body);
    // TEMPORARY Sprint 25 B9 diagnostic (see block above). Emits a sanitized
    // summary and returns; the throw below is unchanged, so classification is
    // not affected.
    emitUpstreamDiagnostic(response, endpoint, parsed);
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
          init: {
            method: string;
            headers?: Record<string, string>;
            body?: string;
            signal?: AbortSignal;
          },
        ) => Promise<{
          status: number;
          ok: boolean;
          text(): Promise<string>;
          headers?: { get(name: string): string | null };
        }>;
      };
      const res = await g.fetch(input, init);
      // Wrap the native Response so the transport surface exposes exactly one
      // named-header reader (delegating to the case-insensitive
      // `Response.headers.get`). No full header set is copied out.
      return {
        status: res.status,
        ok: res.ok,
        text: () => res.text(),
        header: (name: string): string | null =>
          res.headers && typeof res.headers.get === "function"
            ? res.headers.get(name)
            : null,
      };
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
          // Forward the adapter's abort signal so the timeout genuinely
          // cancels the in-flight POST (§2.3 Correction 3).
          ...(input.signal !== undefined ? { signal: input.signal } : {}),
        },
      )) as GoogleClassroomCourseWorkResource;
      return parsed;
    },
  };
}
