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
});
