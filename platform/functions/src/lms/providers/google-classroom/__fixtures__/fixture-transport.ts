// Test-only, in-memory Google Classroom transport.
//
// Sprint 23A (SPRINT_23_ARCHITECTURE_REVIEW.md §6). Deterministic
// fixture that implements `GoogleClassroomTransport` against Google
// Classroom REST v1 payload shapes. Every identifier, name, and token
// in this file is fictional. No real teacher, student, school, OAuth
// credential, or LyfeLabz-affiliated identifier is used.
//
// Location under `__fixtures__/` marks this module as test-only. No
// production module imports it. Attempted production import would be a
// review-blocker.
//
// The fixture supports:
//
// - authorization-code exchange success and configurable failure
// - access-token refresh success and configurable failure
// - token revocation (idempotent per Google contract)
// - paginated teacher-course discovery (deterministic page keys)
// - single-course retrieval (owner mismatch produces the same
//   authorization failure Google returns)
// - paginated student retrieval
// - paginated topic retrieval
// - coursework creation (idempotent under repeated calls in the same
//   fixture instance)
// - explicit "malformed upstream" injection
// - explicit "authorization failure" injection (invalid_grant, 401)
// - explicit "rate-limit / temporary" injection (503/429 shape)

import type {
  GoogleAccessTokenRefreshRequest,
  GoogleAccessTokenRefreshResponse,
  GoogleAuthorizationCodeExchangeRequest,
  GoogleAuthorizationCodeExchangeResponse,
  GoogleClassroomCourseFetchRequest,
  GoogleClassroomCourseListRequest,
  GoogleClassroomCourseListResponse,
  GoogleClassroomCourseResource,
  GoogleClassroomCourseWorkCreateRequest,
  GoogleClassroomCourseWorkResource,
  GoogleClassroomStudentListRequest,
  GoogleClassroomStudentListResponse,
  GoogleClassroomStudentResource,
  GoogleClassroomTopicListRequest,
  GoogleClassroomTopicListResponse,
  GoogleClassroomTopicResource,
  GoogleClassroomTransport,
  GoogleTokenRevokeRequest,
} from "../transport";

// Google returns REST errors as JSON envelopes; the fixture mimics that
// shape so error-translation tests see realistic input. This is a
// plain Error subclass because the adapter is responsible for
// translating upstream errors to `PlatformError` at the boundary; the
// transport surface intentionally speaks Google's language.
export class GoogleClassroomFixtureUpstreamError extends Error {
  readonly status: number;
  readonly errorCode: string;

  constructor(status: number, errorCode: string, message: string) {
    super(message);
    this.name = "GoogleClassroomFixtureUpstreamError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

// Deterministic fictional identifiers. See fixture header for the
// no-real-data invariant.
export const FIXTURE_TEACHER_UPSTREAM_ID = "fixture-teacher-upstream-id-001";
export const FIXTURE_AUTHORIZATION_CODE = "fixture-auth-code-alpha";
export const FIXTURE_ACCESS_TOKEN = "fixture-access-token-xxxxxxxx";
export const FIXTURE_REFRESHED_ACCESS_TOKEN =
  "fixture-access-token-refreshed-yyyyyyyy";
export const FIXTURE_REFRESH_TOKEN = "fixture-refresh-token-zzzzzzzz";
export const FIXTURE_TOKEN_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
];
export const FIXTURE_TOKEN_EXPIRES_IN = 3600;

// Fictional course catalogue. Ordering is stable so pagination tests
// are deterministic.
export const FIXTURE_COURSES: readonly GoogleClassroomCourseResource[] = [
  {
    id: "fixture-course-planet-forge",
    name: "Fictional Course - Planet Forge",
    section: "Block Fixture-A",
    ownerId: FIXTURE_TEACHER_UPSTREAM_ID,
    courseState: "ACTIVE",
  },
  {
    id: "fixture-course-tide-loop",
    name: "Fictional Course - Tide Loop",
    section: "Block Fixture-B",
    ownerId: FIXTURE_TEACHER_UPSTREAM_ID,
    courseState: "ACTIVE",
  },
  {
    id: "fixture-course-signal-drift",
    name: "Fictional Course - Signal Drift",
    ownerId: FIXTURE_TEACHER_UPSTREAM_ID,
    courseState: "ACTIVE",
  },
];

// Course owned by a different fictional teacher; used to prove
// ownership checks.
export const FIXTURE_FOREIGN_COURSE: GoogleClassroomCourseResource = {
  id: "fixture-course-foreign-owner",
  name: "Fictional Course - Foreign Owner",
  ownerId: "fixture-teacher-upstream-id-999",
  courseState: "ACTIVE",
};

export const FIXTURE_STUDENTS_BY_COURSE: Readonly<
  Record<string, readonly GoogleClassroomStudentResource[]>
> = {
  "fixture-course-planet-forge": [
    {
      userId: "fixture-student-upstream-id-101",
      profile: {
        id: "fixture-student-upstream-id-101",
        name: { fullName: "Fictional Student One" },
      },
    },
    {
      userId: "fixture-student-upstream-id-102",
      profile: {
        id: "fixture-student-upstream-id-102",
        name: { fullName: "Fictional Student Two" },
      },
    },
    {
      userId: "fixture-student-upstream-id-103",
      profile: {
        id: "fixture-student-upstream-id-103",
        name: { fullName: "Fictional Student Three" },
      },
    },
  ],
  "fixture-course-tide-loop": [
    {
      userId: "fixture-student-upstream-id-201",
      profile: {
        id: "fixture-student-upstream-id-201",
        name: { fullName: "Fictional Student Four" },
      },
    },
  ],
  "fixture-course-signal-drift": [],
};

export const FIXTURE_TOPICS_BY_COURSE: Readonly<
  Record<string, readonly GoogleClassroomTopicResource[]>
> = {
  "fixture-course-planet-forge": [
    { topicId: "fixture-topic-week-01", name: "Fictional Topic - Week 01" },
    { topicId: "fixture-topic-week-02", name: "Fictional Topic - Week 02" },
    { topicId: "fixture-topic-week-03", name: "Fictional Topic - Week 03" },
  ],
  "fixture-course-tide-loop": [
    { topicId: "fixture-topic-intro", name: "Fictional Topic - Intro" },
  ],
  "fixture-course-signal-drift": [],
};

// Pagination page size for tests. Chosen small (2) so the tests exercise
// more than one page across the 3-course and 3-topic sets.
const FIXTURE_PAGE_SIZE = 2;

export type FixtureFailureMode =
  | "none"
  | "authorization-failure"
  | "rate-limited"
  | "temporary-unavailable"
  | "malformed";

export type GoogleClassroomFixtureOptions = {
  readonly failureMode?: FixtureFailureMode;
  readonly refreshTokenFailureMode?: FixtureFailureMode;
  readonly authorizationCode?: string;
  readonly refreshToken?: string;
};

// Snapshot of the fixture's mutable state so tests can inspect what
// happened. All fields are read-only by contract.
export type GoogleClassroomFixtureCallLog = {
  readonly authorizationCodeExchanges: number;
  readonly accessTokenRefreshes: number;
  readonly tokenRevocations: number;
  readonly courseListCalls: number;
  readonly courseFetchCalls: number;
  readonly studentListCalls: number;
  readonly topicListCalls: number;
  readonly courseWorkCreateCalls: number;
  readonly revokedTokens: readonly string[];
  readonly createdCourseWorkByCourse: Readonly<
    Record<string, readonly GoogleClassroomCourseWorkResource[]>
  >;
};

export function createFixtureGoogleClassroomTransport(
  options: GoogleClassroomFixtureOptions = {},
): GoogleClassroomTransport & {
  readonly log: () => GoogleClassroomFixtureCallLog;
} {
  const acceptedAuthorizationCode =
    options.authorizationCode ?? FIXTURE_AUTHORIZATION_CODE;
  const acceptedRefreshToken =
    options.refreshToken ?? FIXTURE_REFRESH_TOKEN;
  const failureMode = options.failureMode ?? "none";
  const refreshFailureMode = options.refreshTokenFailureMode ?? "none";

  let authorizationCodeExchanges = 0;
  let accessTokenRefreshes = 0;
  let tokenRevocations = 0;
  let courseListCalls = 0;
  let courseFetchCalls = 0;
  let studentListCalls = 0;
  let topicListCalls = 0;
  let courseWorkCreateCalls = 0;
  const revokedTokens: string[] = [];
  const createdCourseWorkByCourse: Record<
    string,
    GoogleClassroomCourseWorkResource[]
  > = {};

  function paginateCourses(
    pageToken: string | undefined,
  ): GoogleClassroomCourseListResponse {
    return paginate(FIXTURE_COURSES, pageToken, (page, nextPageToken) => ({
      courses: page,
      ...(nextPageToken !== undefined ? { nextPageToken } : {}),
    }));
  }

  function paginateStudents(
    courseId: string,
    pageToken: string | undefined,
  ): GoogleClassroomStudentListResponse {
    const roster = FIXTURE_STUDENTS_BY_COURSE[courseId] ?? [];
    return paginate(roster, pageToken, (page, nextPageToken) => ({
      students: page,
      ...(nextPageToken !== undefined ? { nextPageToken } : {}),
    }));
  }

  function paginateTopics(
    courseId: string,
    pageToken: string | undefined,
  ): GoogleClassroomTopicListResponse {
    const topics = FIXTURE_TOPICS_BY_COURSE[courseId] ?? [];
    return paginate(topics, pageToken, (page, nextPageToken) => ({
      topic: page,
      ...(nextPageToken !== undefined ? { nextPageToken } : {}),
    }));
  }

  function applyFailureMode(mode: FixtureFailureMode, op: string): void {
    switch (mode) {
      case "none":
        return;
      case "authorization-failure":
        throw new GoogleClassroomFixtureUpstreamError(
          401,
          "UNAUTHENTICATED",
          `fixture: upstream rejected ${op} as unauthenticated`,
        );
      case "rate-limited":
        throw new GoogleClassroomFixtureUpstreamError(
          429,
          "RESOURCE_EXHAUSTED",
          `fixture: upstream rate-limited ${op}`,
        );
      case "temporary-unavailable":
        throw new GoogleClassroomFixtureUpstreamError(
          503,
          "UNAVAILABLE",
          `fixture: upstream temporarily unavailable for ${op}`,
        );
      case "malformed":
        throw new GoogleClassroomFixtureUpstreamError(
          200,
          "MALFORMED",
          `fixture: upstream returned malformed payload for ${op}`,
        );
    }
  }

  return {
    async exchangeAuthorizationCode(
      input: GoogleAuthorizationCodeExchangeRequest,
    ): Promise<GoogleAuthorizationCodeExchangeResponse> {
      authorizationCodeExchanges += 1;
      applyFailureMode(failureMode, "exchangeAuthorizationCode");
      if (input.code !== acceptedAuthorizationCode) {
        throw new GoogleClassroomFixtureUpstreamError(
          400,
          "invalid_grant",
          "fixture: authorization code does not match",
        );
      }
      return Promise.resolve({
        access_token: FIXTURE_ACCESS_TOKEN,
        refresh_token: FIXTURE_REFRESH_TOKEN,
        expires_in: FIXTURE_TOKEN_EXPIRES_IN,
        scope: FIXTURE_TOKEN_SCOPES.join(" "),
        token_type: "Bearer",
      });
    },

    async refreshAccessToken(
      input: GoogleAccessTokenRefreshRequest,
    ): Promise<GoogleAccessTokenRefreshResponse> {
      accessTokenRefreshes += 1;
      applyFailureMode(refreshFailureMode, "refreshAccessToken");
      if (input.refreshToken !== acceptedRefreshToken) {
        throw new GoogleClassroomFixtureUpstreamError(
          400,
          "invalid_grant",
          "fixture: refresh token does not match",
        );
      }
      return Promise.resolve({
        access_token: FIXTURE_REFRESHED_ACCESS_TOKEN,
        expires_in: FIXTURE_TOKEN_EXPIRES_IN,
        scope: FIXTURE_TOKEN_SCOPES.join(" "),
        token_type: "Bearer",
      });
    },

    async revokeToken(input: GoogleTokenRevokeRequest): Promise<void> {
      tokenRevocations += 1;
      applyFailureMode(failureMode, "revokeToken");
      // Google's revoke endpoint is idempotent; unknown tokens still
      // return 200. Fixture matches that contract.
      revokedTokens.push(input.token);
      return Promise.resolve();
    },

    async listTeacherCourses(
      input: GoogleClassroomCourseListRequest,
    ): Promise<GoogleClassroomCourseListResponse> {
      courseListCalls += 1;
      applyFailureMode(failureMode, "listTeacherCourses");
      requireAccessToken(input.accessToken, "listTeacherCourses");
      return Promise.resolve(paginateCourses(input.pageToken));
    },

    async fetchCourse(
      input: GoogleClassroomCourseFetchRequest,
    ): Promise<GoogleClassroomCourseResource> {
      courseFetchCalls += 1;
      applyFailureMode(failureMode, "fetchCourse");
      requireAccessToken(input.accessToken, "fetchCourse");
      const found =
        FIXTURE_COURSES.find((c) => c.id === input.courseId) ??
        (input.courseId === FIXTURE_FOREIGN_COURSE.id
          ? FIXTURE_FOREIGN_COURSE
          : undefined);
      if (!found) {
        throw new GoogleClassroomFixtureUpstreamError(
          404,
          "NOT_FOUND",
          `fixture: course ${input.courseId} does not exist`,
        );
      }
      return Promise.resolve(found);
    },

    async listCourseStudents(
      input: GoogleClassroomStudentListRequest,
    ): Promise<GoogleClassroomStudentListResponse> {
      studentListCalls += 1;
      applyFailureMode(failureMode, "listCourseStudents");
      requireAccessToken(input.accessToken, "listCourseStudents");
      return Promise.resolve(
        paginateStudents(input.courseId, input.pageToken),
      );
    },

    async listCourseTopics(
      input: GoogleClassroomTopicListRequest,
    ): Promise<GoogleClassroomTopicListResponse> {
      topicListCalls += 1;
      applyFailureMode(failureMode, "listCourseTopics");
      requireAccessToken(input.accessToken, "listCourseTopics");
      return Promise.resolve(
        paginateTopics(input.courseId, input.pageToken),
      );
    },

    async createCourseWork(
      input: GoogleClassroomCourseWorkCreateRequest,
    ): Promise<GoogleClassroomCourseWorkResource> {
      courseWorkCreateCalls += 1;
      applyFailureMode(failureMode, "createCourseWork");
      requireAccessToken(input.accessToken, "createCourseWork");
      const existing = createdCourseWorkByCourse[input.courseId] ?? [];
      // The fixture treats (courseId, title, link) as an idempotency
      // key: repeated calls return the previously-created resource.
      // Google Classroom itself is not idempotent, but the core
      // callable (`lms/assignments-publish.ts`) treats a previously
      // recorded publication as a no-op; this fixture cooperates with
      // that contract so tests can verify safe replay.
      const previously = existing.find(
        (r) => r.id === derivePublicationId(input),
      );
      if (previously) {
        return Promise.resolve(previously);
      }
      const created: GoogleClassroomCourseWorkResource = {
        id: derivePublicationId(input),
        alternateLink: `https://classroom.google.com/c/${encodeURIComponent(input.courseId)}/a/${encodeURIComponent(derivePublicationId(input))}/details`,
      };
      createdCourseWorkByCourse[input.courseId] = [...existing, created];
      return Promise.resolve(created);
    },

    log(): GoogleClassroomFixtureCallLog {
      const frozenCreated: Record<
        string,
        readonly GoogleClassroomCourseWorkResource[]
      > = {};
      for (const [k, v] of Object.entries(createdCourseWorkByCourse)) {
        frozenCreated[k] = [...v];
      }
      return {
        authorizationCodeExchanges,
        accessTokenRefreshes,
        tokenRevocations,
        courseListCalls,
        courseFetchCalls,
        studentListCalls,
        topicListCalls,
        courseWorkCreateCalls,
        revokedTokens: [...revokedTokens],
        createdCourseWorkByCourse: frozenCreated,
      };
    },
  };
}

function requireAccessToken(token: string, op: string): void {
  if (!token || typeof token !== "string") {
    throw new GoogleClassroomFixtureUpstreamError(
      401,
      "UNAUTHENTICATED",
      `fixture: ${op} requires an access token`,
    );
  }
}

function derivePublicationId(
  input: GoogleClassroomCourseWorkCreateRequest,
): string {
  // Deterministic fictional id based on the LyfeLabz link. Google
  // itself returns opaque numeric ids; the shape difference is
  // irrelevant because the adapter treats the id as opaque.
  const linkKey = input.link.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 64);
  return `fixture-coursework-${linkKey}`;
}

function paginate<TItem, TResponse>(
  items: readonly TItem[],
  pageToken: string | undefined,
  build: (
    page: readonly TItem[],
    nextPageToken: string | undefined,
  ) => TResponse,
): TResponse {
  const start = pageToken ? parseInt(pageToken, 10) : 0;
  if (Number.isNaN(start) || start < 0 || start > items.length) {
    throw new GoogleClassroomFixtureUpstreamError(
      400,
      "INVALID_ARGUMENT",
      `fixture: invalid pageToken ${pageToken ?? "<undefined>"}`,
    );
  }
  const end = Math.min(start + FIXTURE_PAGE_SIZE, items.length);
  const page = items.slice(start, end);
  const nextPageToken = end < items.length ? String(end) : undefined;
  return build(page, nextPageToken);
}
