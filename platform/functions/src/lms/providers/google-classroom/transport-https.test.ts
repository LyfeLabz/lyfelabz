// Sprint 23B coverage for the fetch-based production HTTPS transport.
//
// Uses an injected `fetchImpl` so the test is deterministic and does
// not require network access. Verifies:
//   - authorization-code exchange serializes the form body with the
//     configured client id + secret and the caller's redirect URI;
//   - refresh serializes correctly;
//   - revoke posts the token;
//   - course list, course fetch, students, topics, and courseWork
//     hit the right endpoints and headers;
//   - non-2xx responses raise `GoogleClassroomHttpsError` with a
//     translated status code and upstream code;
//   - malformed 2xx bodies raise the MALFORMED shape;
//   - the transport never logs the request body (no assertion here
//     directly; instead the test confirms only the parameters we
//     supplied come through, i.e. no leakage-via-side-effect).

import { logger } from "firebase-functions";

import {
  GoogleClassroomHttpsError,
  createHttpsGoogleClassroomTransport,
  type HttpsFetch,
} from "./transport";

const FIXTURE_CLIENT_ID = "fixture-oauth-client-id";
const FIXTURE_CLIENT_SECRET = "fixture-oauth-client-secret-never-real";

type RecordedRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
};

function makeFetchImpl(
  handler: (req: RecordedRequest) => { status: number; body: string },
): { fetchImpl: HttpsFetch; recorded: RecordedRequest[] } {
  const recorded: RecordedRequest[] = [];
  const fetchImpl: HttpsFetch = (input, init) => {
    const request: RecordedRequest = {
      url: input,
      method: init.method,
      headers: init.headers ?? {},
      ...(init.body !== undefined ? { body: init.body } : {}),
    };
    recorded.push(request);
    const response = handler(request);
    return Promise.resolve({
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: () => Promise.resolve(response.body),
    });
  };
  return { fetchImpl, recorded };
}

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [k, v = ""] = pair.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return out;
}

describe("createHttpsGoogleClassroomTransport", () => {
  describe("exchangeAuthorizationCode", () => {
    it("posts the code + config + redirect to the Google token endpoint", async () => {
      const { fetchImpl, recorded } = makeFetchImpl(() => ({
        status: 200,
        body: JSON.stringify({
          access_token: "fixture-access-token",
          refresh_token: "fixture-refresh-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/classroom.courses.readonly",
          token_type: "Bearer",
        }),
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      const response = await transport.exchangeAuthorizationCode({
        code: "fixture-auth-code",
        redirectUri: "https://fixture.example.invalid/lms-callback",
      });
      expect(response.access_token).toBe("fixture-access-token");
      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toBe("https://oauth2.googleapis.com/token");
      expect(recorded[0].method).toBe("POST");
      expect(recorded[0].headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
      const form = parseForm(recorded[0].body ?? "");
      expect(form.grant_type).toBe("authorization_code");
      expect(form.code).toBe("fixture-auth-code");
      expect(form.redirect_uri).toBe(
        "https://fixture.example.invalid/lms-callback",
      );
      expect(form.client_id).toBe(FIXTURE_CLIENT_ID);
      expect(form.client_secret).toBe(FIXTURE_CLIENT_SECRET);
    });

    it("translates a 400 invalid_grant into GoogleClassroomHttpsError", async () => {
      const { fetchImpl } = makeFetchImpl(() => ({
        status: 400,
        body: JSON.stringify({ error: "invalid_grant" }),
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      let observed: unknown;
      try {
        await transport.exchangeAuthorizationCode({
          code: "wrong",
          redirectUri: "https://fixture.example.invalid/lms-callback",
        });
      } catch (err) {
        observed = err;
      }
      expect(observed).toBeInstanceOf(GoogleClassroomHttpsError);
      expect((observed as GoogleClassroomHttpsError).status).toBe(400);
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "invalid_grant",
      );
    });

    it("translates a non-JSON 2xx body into a MALFORMED error", async () => {
      const { fetchImpl } = makeFetchImpl(() => ({
        status: 200,
        body: "not json",
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      let observed: unknown;
      try {
        await transport.exchangeAuthorizationCode({
          code: "fixture-code",
          redirectUri: "https://fixture.example.invalid/lms-callback",
        });
      } catch (err) {
        observed = err;
      }
      expect(observed).toBeInstanceOf(GoogleClassroomHttpsError);
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "MALFORMED",
      );
    });
  });

  describe("refreshAccessToken", () => {
    it("posts refresh_token grant with the configured client credentials", async () => {
      const { fetchImpl, recorded } = makeFetchImpl(() => ({
        status: 200,
        body: JSON.stringify({
          access_token: "fixture-refreshed",
          expires_in: 3600,
          scope: "s",
          token_type: "Bearer",
        }),
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      await transport.refreshAccessToken({
        refreshToken: "fixture-refresh-token",
      });
      const form = parseForm(recorded[0].body ?? "");
      expect(form.grant_type).toBe("refresh_token");
      expect(form.refresh_token).toBe("fixture-refresh-token");
      expect(form.client_id).toBe(FIXTURE_CLIENT_ID);
      expect(form.client_secret).toBe(FIXTURE_CLIENT_SECRET);
    });
  });

  describe("revokeToken", () => {
    it("posts the token to the revoke endpoint", async () => {
      const { fetchImpl, recorded } = makeFetchImpl(() => ({
        status: 200,
        body: "",
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      await transport.revokeToken({ token: "fixture-refresh-token" });
      expect(recorded[0].url).toBe("https://oauth2.googleapis.com/revoke");
      const form = parseForm(recorded[0].body ?? "");
      expect(form.token).toBe("fixture-refresh-token");
    });
  });

  describe("Classroom REST v1", () => {
    it("listTeacherCourses queries /courses with teacherId=me and forwards the access token", async () => {
      const { fetchImpl, recorded } = makeFetchImpl(() => ({
        status: 200,
        body: JSON.stringify({ courses: [], nextPageToken: undefined }),
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      await transport.listTeacherCourses({
        accessToken: "fixture-access-token",
        pageToken: "next-page",
      });
      expect(recorded[0].url).toContain(
        "https://classroom.googleapis.com/v1/courses?",
      );
      expect(recorded[0].url).toContain("teacherId=me");
      expect(recorded[0].url).toContain("courseStates=ACTIVE");
      expect(recorded[0].url).toContain("pageToken=next-page");
      expect(recorded[0].headers.Authorization).toBe(
        "Bearer fixture-access-token",
      );
    });

    it("fetchCourse queries /courses/{id}", async () => {
      const { fetchImpl, recorded } = makeFetchImpl(() => ({
        status: 200,
        body: JSON.stringify({
          id: "fixture-course-planet-forge",
          name: "Fictional",
          ownerId: "fixture-teacher",
          courseState: "ACTIVE",
        }),
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      const course = await transport.fetchCourse({
        accessToken: "fixture-access-token",
        courseId: "fixture-course-planet-forge",
      });
      expect(course.name).toBe("Fictional");
      expect(recorded[0].url).toBe(
        "https://classroom.googleapis.com/v1/courses/fixture-course-planet-forge",
      );
    });

    it("getUserProfileMe queries /userProfiles/me", async () => {
      const { fetchImpl, recorded } = makeFetchImpl(() => ({
        status: 200,
        body: JSON.stringify({ id: "fixture-teacher-upstream" }),
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      const profile = await transport.getUserProfileMe({
        accessToken: "fixture-access-token",
      });
      expect(profile.id).toBe("fixture-teacher-upstream");
      expect(recorded[0].url).toBe(
        "https://classroom.googleapis.com/v1/userProfiles/me",
      );
    });

    it("translates a 401 into GoogleClassroomHttpsError with status 401", async () => {
      const { fetchImpl } = makeFetchImpl(() => ({
        status: 401,
        body: JSON.stringify({
          error: { status: "UNAUTHENTICATED", message: "Invalid Credentials" },
        }),
      }));
      const transport = createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
      let observed: unknown;
      try {
        await transport.listTeacherCourses({
          accessToken: "fixture-access-token",
        });
      } catch (err) {
        observed = err;
      }
      expect(observed).toBeInstanceOf(GoogleClassroomHttpsError);
      expect((observed as GoogleClassroomHttpsError).status).toBe(401);
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "UNAUTHENTICATED",
      );
    });
  });

  // Real-Google insufficient-scope error shape (Sprint 25 certification
  // finding). A genuine 403 for an OAuth scope shortfall carries the generic
  // top-level status "PERMISSION_DENIED" and the discriminating reason
  // "ACCESS_TOKEN_SCOPE_INSUFFICIENT" nested in error.details[]. The
  // transport must surface that reason as the upstreamCode so the adapter
  // can classify insufficient scope; an ordinary permission denial (no such
  // reason) must keep reporting "PERMISSION_DENIED".
  describe("insufficient-scope 403 (real Google error shape)", () => {
    // Exact body Google returns when the access token lacks a required
    // Classroom scope, e.g. classroom.topics.readonly for topics.list or
    // classroom.coursework.students for teacher-side courseWork.create.
    const SCOPE_INSUFFICIENT_BODY = JSON.stringify({
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
            domain: "googleapis.com",
            metadata: { service: "classroom.googleapis.com" },
          },
        ],
      },
    });

    // An ordinary permission denial: valid scopes, but the caller is not
    // permitted on this resource. Same 403 + PERMISSION_DENIED, but no
    // scope-insufficient reason.
    const ORDINARY_DENIAL_BODY = JSON.stringify({
      error: {
        code: 403,
        message: "The caller does not have permission.",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "IAM_PERMISSION_DENIED",
            domain: "googleapis.com",
          },
        ],
      },
    });

    function makeTransport(status: number, body: string) {
      const { fetchImpl } = makeFetchImpl(() => ({ status, body }));
      return createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
    }

    async function capture(op: () => Promise<unknown>): Promise<unknown> {
      try {
        await op();
      } catch (err) {
        return err;
      }
      return undefined;
    }

    it("surfaces ACCESS_TOKEN_SCOPE_INSUFFICIENT from listCourseTopics details[]", async () => {
      const transport = makeTransport(403, SCOPE_INSUFFICIENT_BODY);
      const observed = await capture(() =>
        transport.listCourseTopics({
          accessToken: "fixture-access-token",
          courseId: "fixture-course-planet-forge",
        }),
      );
      expect(observed).toBeInstanceOf(GoogleClassroomHttpsError);
      expect((observed as GoogleClassroomHttpsError).status).toBe(403);
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      );
    });

    it("surfaces ACCESS_TOKEN_SCOPE_INSUFFICIENT from createCourseWork details[]", async () => {
      const transport = makeTransport(403, SCOPE_INSUFFICIENT_BODY);
      const observed = await capture(() =>
        transport.createCourseWork({
          accessToken: "fixture-access-token",
          courseId: "fixture-course-planet-forge",
          title: "Fictional Assignment",
          link: "https://app.lyfelabz.invalid/a/fixture-assignment-1",
        }),
      );
      expect(observed).toBeInstanceOf(GoogleClassroomHttpsError);
      expect((observed as GoogleClassroomHttpsError).status).toBe(403);
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      );
    });

    it("keeps PERMISSION_DENIED for an ordinary 403 without a scope-insufficient reason", async () => {
      const transport = makeTransport(403, ORDINARY_DENIAL_BODY);
      const observed = await capture(() =>
        transport.listCourseTopics({
          accessToken: "fixture-access-token",
          courseId: "fixture-course-planet-forge",
        }),
      );
      expect(observed).toBeInstanceOf(GoogleClassroomHttpsError);
      expect((observed as GoogleClassroomHttpsError).status).toBe(403);
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "PERMISSION_DENIED",
      );
    });
  });

  // ==========================================================================
  // TEMPORARY - Sprint 25 B9 certification diagnostic (see the matching block
  // in transport.ts). These tests pin the sanitized diagnostic emitted at the
  // non-2xx boundary and prove it never leaks credentials or full bodies, and
  // that it does NOT alter classification. Remove or adapt alongside the
  // instrumentation before Sprint 25 closeout.
  // ==========================================================================
  describe("B9 sanitized upstream diagnostic", () => {
    const DIAGNOSTIC_EVENT = "lms.googleClassroomUpstreamDiagnostic";
    const FIXTURE_BEARER = "fixture-secret-access-token-value";

    const SCOPE_INSUFFICIENT_BODY = JSON.stringify({
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
            domain: "googleapis.com",
          },
        ],
      },
    });

    const ORDINARY_DENIAL_BODY = JSON.stringify({
      error: {
        code: 403,
        message: "The caller does not have permission.",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "IAM_PERMISSION_DENIED",
            domain: "googleapis.com",
          },
        ],
      },
    });

    // A fetchImpl that also exposes a single named response header via the
    // optional `header()` reader (mirrors the production global-fetch binding).
    function makeFetchImplWithHeaders(
      handler: (req: RecordedRequest) => {
        status: number;
        body: string;
        headers?: Record<string, string>;
      },
    ): { fetchImpl: HttpsFetch; recorded: RecordedRequest[] } {
      const recorded: RecordedRequest[] = [];
      const fetchImpl: HttpsFetch = (input, init) => {
        const request: RecordedRequest = {
          url: input,
          method: init.method,
          headers: init.headers ?? {},
          ...(init.body !== undefined ? { body: init.body } : {}),
        };
        recorded.push(request);
        const response = handler(request);
        const responseHeaders = response.headers ?? {};
        return Promise.resolve({
          status: response.status,
          ok: response.status >= 200 && response.status < 300,
          text: () => Promise.resolve(response.body),
          header: (name: string): string | null => {
            // Case-insensitive lookup, matching Response.headers.get.
            const key = Object.keys(responseHeaders).find(
              (k) => k.toLowerCase() === name.toLowerCase(),
            );
            return key !== undefined ? responseHeaders[key] : null;
          },
        });
      };
      return { fetchImpl, recorded };
    }

    function makeTransportWithHeaders(
      status: number,
      body: string,
      headers?: Record<string, string>,
    ) {
      const { fetchImpl } = makeFetchImplWithHeaders(() => ({
        status,
        body,
        ...(headers ? { headers } : {}),
      }));
      return createHttpsGoogleClassroomTransport({
        resolveConfig: () => ({
          clientId: FIXTURE_CLIENT_ID,
          clientSecret: FIXTURE_CLIENT_SECRET,
        }),
        fetchImpl,
      });
    }

    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    function lastDiagnostic(): Record<string, unknown> {
      const call = warnSpy.mock.calls.find((c) => c[0] === DIAGNOSTIC_EVENT);
      expect(call).toBeDefined();
      return call![1] as Record<string, unknown>;
    }

    async function capture(op: () => Promise<unknown>): Promise<void> {
      try {
        await op();
      } catch {
        // Expected: the diagnostic fires on the failure path.
      }
    }

    // A. 403 with error.status + details[].reason + WWW-Authenticate produces
    //    the sanitized diagnostic fields.
    it("A: captures status, error.status, detail reasons, and the WWW-Authenticate token from a 403", async () => {
      const body = JSON.stringify({
        error: {
          code: 403,
          message: "Request had insufficient authentication scopes.",
          status: "PERMISSION_DENIED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              domain: "googleapis.com",
            },
          ],
        },
      });
      const transport = makeTransportWithHeaders(403, body, {
        "WWW-Authenticate":
          'Bearer realm="https://accounts.google.com/", error="insufficient_scope", error_description="Request had insufficient authentication scopes."',
      });
      await capture(() =>
        transport.createCourseWork({
          accessToken: FIXTURE_BEARER,
          courseId: "fixture-course-planet-forge",
          title: "Fictional Assignment",
          link: "https://app.lyfelabz.invalid/a/fixture-assignment-1",
        }),
      );
      const d = lastDiagnostic();
      expect(d.httpStatus).toBe(403);
      expect(d.errorStatus).toBe("PERMISSION_DENIED");
      expect(d.detailReasons).toEqual(["ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);
      expect(d.wwwAuthenticateError).toBe("insufficient_scope");
      expect(d.wwwAuthenticatePresent).toBe(true);
      expect(d.wwwAuthenticateErrorDescriptionPresent).toBe(true);
      expect(d.errorMessagePresent).toBe(true);
      expect(d.errorMessageCategory).toBe("insufficientAuthenticationScopes");
      expect(d.temporary).toBe(true);
      // The route must not carry the course id.
      expect(d.route).toBe("/v1/courses/{id}/courseWork");
      expect(String(d.route)).not.toContain("fixture-course-planet-forge");
    });

    // B. 401 with WWW-Authenticate produces the sanitized authentication error
    //    token.
    it("B: captures the invalid_token authentication error token from a 401", async () => {
      const body = JSON.stringify({
        error: { status: "UNAUTHENTICATED", message: "Invalid Credentials" },
      });
      const transport = makeTransportWithHeaders(401, body, {
        "WWW-Authenticate":
          'Bearer realm="https://accounts.google.com/", error="invalid_token"',
      });
      await capture(() =>
        transport.listTeacherCourses({ accessToken: FIXTURE_BEARER }),
      );
      const d = lastDiagnostic();
      expect(d.httpStatus).toBe(401);
      expect(d.errorStatus).toBe("UNAUTHENTICATED");
      expect(d.wwwAuthenticateError).toBe("invalid_token");
      expect(d.errorMessageCategory).toBe("invalidCredentials");
    });

    // C. Authorization bearer tokens are NEVER present in the diagnostic.
    it("C: never includes the access token, the word Bearer, or an Authorization header", async () => {
      const transport = makeTransportWithHeaders(
        403,
        SCOPE_INSUFFICIENT_BODY,
        {
          "WWW-Authenticate": 'Bearer error="insufficient_scope"',
        },
      );
      await capture(() =>
        transport.createCourseWork({
          accessToken: FIXTURE_BEARER,
          courseId: "fixture-course-planet-forge",
          title: "Fictional Assignment",
          link: "https://app.lyfelabz.invalid/a/fixture-assignment-1",
        }),
      );
      const serialized = JSON.stringify(lastDiagnostic());
      expect(serialized).not.toContain(FIXTURE_BEARER);
      expect(serialized).not.toContain("Bearer");
      expect(serialized.toLowerCase()).not.toContain("authorization");
    });

    // D. Full response bodies (and free-form messages / identifiers within
    //    them) are NEVER logged.
    it("D: never logs the full body or a free-form (identifier-bearing) message", async () => {
      const identifyingBody = JSON.stringify({
        error: {
          code: 403,
          message:
            "User teacher-name@example.invalid lacks scope for course 987654321.",
          status: "PERMISSION_DENIED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
            },
          ],
        },
      });
      const transport = makeTransportWithHeaders(403, identifyingBody);
      await capture(() =>
        transport.createCourseWork({
          accessToken: FIXTURE_BEARER,
          courseId: "987654321",
          title: "Fictional Assignment",
          link: "https://app.lyfelabz.invalid/a/fixture-assignment-1",
        }),
      );
      const d = lastDiagnostic();
      const serialized = JSON.stringify(d);
      // The categorical shape is still captured...
      expect(d.errorMessagePresent).toBe(true);
      expect(d.detailReasons).toEqual(["ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);
      // ...but no free-form message, email, or course id is present, and the
      // unknown message is not reduced to a category.
      expect(d.errorMessageCategory).toBeUndefined();
      expect(serialized).not.toContain("teacher-name@example.invalid");
      expect(serialized).not.toContain("987654321");
      expect(serialized).not.toContain("lacks scope");
      expect(serialized).not.toContain(identifyingBody);
    });

    // E. Existing classification remains unchanged by this diagnostic patch:
    //    the same upstreamCode is still thrown, and an ordinary denial still
    //    reports PERMISSION_DENIED.
    it("E: does not change the thrown upstreamCode (insufficient-scope path)", async () => {
      const transport = makeTransportWithHeaders(403, SCOPE_INSUFFICIENT_BODY);
      let observed: unknown;
      try {
        await transport.listCourseTopics({
          accessToken: FIXTURE_BEARER,
          courseId: "fixture-course-planet-forge",
        });
      } catch (err) {
        observed = err;
      }
      expect(observed).toBeInstanceOf(GoogleClassroomHttpsError);
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      );
      // The diagnostic fired, but classification is unchanged.
      expect(warnSpy).toHaveBeenCalled();
    });

    it("E: does not change the thrown upstreamCode (ordinary PERMISSION_DENIED path)", async () => {
      const transport = makeTransportWithHeaders(403, ORDINARY_DENIAL_BODY);
      let observed: unknown;
      try {
        await transport.listCourseTopics({
          accessToken: FIXTURE_BEARER,
          courseId: "fixture-course-planet-forge",
        });
      } catch (err) {
        observed = err;
      }
      expect((observed as GoogleClassroomHttpsError).upstreamCode).toBe(
        "PERMISSION_DENIED",
      );
      const d = lastDiagnostic();
      expect(d.detailReasons).toEqual(["IAM_PERMISSION_DENIED"]);
      expect(d.wwwAuthenticatePresent).toBe(false);
    });

    it("emits no diagnostic on a 2xx success", async () => {
      const transport = makeTransportWithHeaders(
        200,
        JSON.stringify({ id: "fixture-coursework-ok" }),
      );
      await transport.createCourseWork({
        accessToken: FIXTURE_BEARER,
        courseId: "fixture-course-planet-forge",
        title: "Fictional Assignment",
        link: "https://app.lyfelabz.invalid/a/fixture-assignment-1",
      });
      const call = warnSpy.mock.calls.find((c) => c[0] === DIAGNOSTIC_EVENT);
      expect(call).toBeUndefined();
    });
  });
});
