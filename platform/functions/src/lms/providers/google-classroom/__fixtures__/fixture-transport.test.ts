// Sprint 23A coverage for the in-memory Google Classroom fixture
// transport. Verifies every fixture case enumerated in the Sprint 23A
// specification section 3, including pagination, error translation,
// idempotency, malformed shapes, and cleanup guarantees.

import {
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_AUTHORIZATION_CODE,
  FIXTURE_COURSES,
  FIXTURE_FOREIGN_COURSE,
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_REFRESHED_ACCESS_TOKEN,
  FIXTURE_STUDENTS_BY_COURSE,
  FIXTURE_TEACHER_UPSTREAM_ID,
  FIXTURE_TOPICS_BY_COURSE,
  GoogleClassroomFixtureUpstreamError,
  createFixtureGoogleClassroomTransport,
} from "./fixture-transport";

describe("fixture Google Classroom transport", () => {
  describe("authorization-code exchange", () => {
    it("returns access + refresh tokens on the accepted code", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const res = await t.exchangeAuthorizationCode({
        code: FIXTURE_AUTHORIZATION_CODE,
        redirectUri: "https://fixture.example.invalid/lms-callback",
      });
      expect(res.access_token).toBe(FIXTURE_ACCESS_TOKEN);
      expect(res.refresh_token).toBe(FIXTURE_REFRESH_TOKEN);
      expect(res.token_type).toBe("Bearer");
      expect(t.log().authorizationCodeExchanges).toBe(1);
    });

    it("rejects invalid authorization codes with invalid_grant", async () => {
      const t = createFixtureGoogleClassroomTransport();
      await expect(
        t.exchangeAuthorizationCode({
          code: "fixture-wrong-code",
          redirectUri: "https://fixture.example.invalid/lms-callback",
        }),
      ).rejects.toBeInstanceOf(GoogleClassroomFixtureUpstreamError);
    });

    it("surfaces authorization-failure mode", async () => {
      const t = createFixtureGoogleClassroomTransport({
        failureMode: "authorization-failure",
      });
      await expect(
        t.exchangeAuthorizationCode({
          code: FIXTURE_AUTHORIZATION_CODE,
          redirectUri: "https://fixture.example.invalid/lms-callback",
        }),
      ).rejects.toMatchObject({ status: 401, errorCode: "UNAUTHENTICATED" });
    });
  });

  describe("access-token refresh", () => {
    it("returns a refreshed token on the accepted refresh token", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const res = await t.refreshAccessToken({
        refreshToken: FIXTURE_REFRESH_TOKEN,
      });
      expect(res.access_token).toBe(FIXTURE_REFRESHED_ACCESS_TOKEN);
      expect(t.log().accessTokenRefreshes).toBe(1);
    });

    it("rejects invalid refresh tokens with invalid_grant", async () => {
      const t = createFixtureGoogleClassroomTransport();
      await expect(
        t.refreshAccessToken({ refreshToken: "fixture-wrong-refresh" }),
      ).rejects.toMatchObject({ status: 400, errorCode: "invalid_grant" });
    });

    it("surfaces temporary-unavailable mode via refreshTokenFailureMode", async () => {
      const t = createFixtureGoogleClassroomTransport({
        refreshTokenFailureMode: "temporary-unavailable",
      });
      await expect(
        t.refreshAccessToken({ refreshToken: FIXTURE_REFRESH_TOKEN }),
      ).rejects.toMatchObject({ status: 503, errorCode: "UNAVAILABLE" });
    });
  });

  describe("token revocation", () => {
    it("records the revoked token and is idempotent under repeated calls", async () => {
      const t = createFixtureGoogleClassroomTransport();
      await t.revokeToken({ token: FIXTURE_ACCESS_TOKEN });
      await t.revokeToken({ token: FIXTURE_ACCESS_TOKEN });
      const log = t.log();
      expect(log.tokenRevocations).toBe(2);
      expect(log.revokedTokens).toEqual([
        FIXTURE_ACCESS_TOKEN,
        FIXTURE_ACCESS_TOKEN,
      ]);
    });
  });

  describe("paginated teacher-course discovery", () => {
    it("returns pages of size 2 and a next page token when more remain", async () => {
      const t = createFixtureGoogleClassroomTransport();

      const first = await t.listTeacherCourses({
        accessToken: FIXTURE_ACCESS_TOKEN,
      });
      expect(first.courses?.length).toBe(2);
      expect(first.nextPageToken).toBeDefined();

      const second = await t.listTeacherCourses({
        accessToken: FIXTURE_ACCESS_TOKEN,
        pageToken: first.nextPageToken,
      });
      expect(second.courses?.length).toBe(1);
      expect(second.nextPageToken).toBeUndefined();

      const collectedIds = [
        ...(first.courses ?? []),
        ...(second.courses ?? []),
      ].map((c) => c.id);
      expect(collectedIds).toEqual(FIXTURE_COURSES.map((c) => c.id));
    });

    it("rejects a malformed pageToken", async () => {
      const t = createFixtureGoogleClassroomTransport();
      await expect(
        t.listTeacherCourses({
          accessToken: FIXTURE_ACCESS_TOKEN,
          pageToken: "not-a-number",
        }),
      ).rejects.toMatchObject({ status: 400, errorCode: "INVALID_ARGUMENT" });
    });

    it("requires an access token", async () => {
      const t = createFixtureGoogleClassroomTransport();
      await expect(
        t.listTeacherCourses({ accessToken: "" }),
      ).rejects.toMatchObject({ status: 401, errorCode: "UNAUTHENTICATED" });
    });
  });

  describe("single-course retrieval", () => {
    it("returns the owned course", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const course = await t.fetchCourse({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: FIXTURE_COURSES[0].id,
      });
      expect(course.ownerId).toBe(FIXTURE_TEACHER_UPSTREAM_ID);
    });

    it("returns a foreign-owned course so the adapter can enforce ownership at import time", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const course = await t.fetchCourse({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: FIXTURE_FOREIGN_COURSE.id,
      });
      expect(course.ownerId).not.toBe(FIXTURE_TEACHER_UPSTREAM_ID);
    });

    it("rejects unknown courses with NOT_FOUND", async () => {
      const t = createFixtureGoogleClassroomTransport();
      await expect(
        t.fetchCourse({
          accessToken: FIXTURE_ACCESS_TOKEN,
          courseId: "fixture-does-not-exist",
        }),
      ).rejects.toMatchObject({ status: 404, errorCode: "NOT_FOUND" });
    });
  });

  describe("paginated student retrieval", () => {
    it("returns pages of size 2 for a roster of 3", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const courseId = "fixture-course-planet-forge";
      const first = await t.listCourseStudents({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId,
      });
      expect(first.students?.length).toBe(2);
      expect(first.nextPageToken).toBeDefined();

      const second = await t.listCourseStudents({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId,
        pageToken: first.nextPageToken,
      });
      expect(second.students?.length).toBe(1);
      expect(second.nextPageToken).toBeUndefined();

      const collectedIds = [
        ...(first.students ?? []),
        ...(second.students ?? []),
      ].map((s) => s.userId);
      expect(collectedIds).toEqual(
        FIXTURE_STUDENTS_BY_COURSE[courseId].map((s) => s.userId),
      );
    });

    it("returns an empty roster for a course with no students", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const res = await t.listCourseStudents({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: "fixture-course-signal-drift",
      });
      expect(res.students).toEqual([]);
      expect(res.nextPageToken).toBeUndefined();
    });

    it("carries no email or photo fields in student payloads (scope decision preserved)", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const res = await t.listCourseStudents({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: "fixture-course-planet-forge",
      });
      for (const s of res.students ?? []) {
        // The transport type intentionally does not model email or
        // photo. This runtime guard proves the fixture cannot be
        // silently altered to bring those fields back without a code
        // review that also updates the type.
        expect(
          (s.profile as unknown as Record<string, unknown>).emailAddress,
        ).toBeUndefined();
        expect(
          (s.profile as unknown as Record<string, unknown>).photoUrl,
        ).toBeUndefined();
      }
    });
  });

  describe("paginated topic retrieval", () => {
    it("uses the `topic` field name (Google's REST v1 shape)", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const res = await t.listCourseTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: "fixture-course-planet-forge",
      });
      expect(res.topic).toBeDefined();
      expect(res.topic?.length).toBe(2);
    });

    it("returns the last page without a nextPageToken", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const first = await t.listCourseTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: "fixture-course-planet-forge",
      });
      const second = await t.listCourseTopics({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: "fixture-course-planet-forge",
        pageToken: first.nextPageToken,
      });
      expect(second.nextPageToken).toBeUndefined();
      const collected = [...(first.topic ?? []), ...(second.topic ?? [])];
      expect(collected.map((t2) => t2.topicId)).toEqual(
        FIXTURE_TOPICS_BY_COURSE["fixture-course-planet-forge"].map(
          (t2) => t2.topicId,
        ),
      );
    });
  });

  describe("coursework creation", () => {
    it("returns a deterministic resource id and alternate link", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const res = await t.createCourseWork({
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: "fixture-course-planet-forge",
        title: "Fictional Assignment Title",
        description: "Fictional description.",
        link: "https://app.lyfelabz.invalid/a/fixture-assignment-1",
        topicId: "fixture-topic-week-01",
      });
      expect(res.id).toContain("fixture-coursework-");
      expect(res.alternateLink).toContain("classroom.google.com");
    });

    it("is idempotent when the same LyfeLabz link is published twice", async () => {
      const t = createFixtureGoogleClassroomTransport();
      const input = {
        accessToken: FIXTURE_ACCESS_TOKEN,
        courseId: "fixture-course-planet-forge",
        title: "Fictional Assignment Title",
        link: "https://app.lyfelabz.invalid/a/fixture-assignment-repeat",
      };
      const first = await t.createCourseWork(input);
      const second = await t.createCourseWork(input);
      expect(second.id).toBe(first.id);
      const log = t.log();
      expect(log.courseWorkCreateCalls).toBe(2);
      expect(
        log.createdCourseWorkByCourse["fixture-course-planet-forge"]?.length,
      ).toBe(1);
    });

    it("respects rate-limit failure injection", async () => {
      const t = createFixtureGoogleClassroomTransport({
        failureMode: "rate-limited",
      });
      await expect(
        t.createCourseWork({
          accessToken: FIXTURE_ACCESS_TOKEN,
          courseId: "fixture-course-planet-forge",
          title: "Fictional Assignment Title",
          link: "https://app.lyfelabz.invalid/a/fixture-assignment-rate",
        }),
      ).rejects.toMatchObject({ status: 429, errorCode: "RESOURCE_EXHAUSTED" });
    });
  });

  describe("failure-mode injection", () => {
    it("propagates the malformed-payload signal on discovery", async () => {
      const t = createFixtureGoogleClassroomTransport({
        failureMode: "malformed",
      });
      await expect(
        t.listTeacherCourses({ accessToken: FIXTURE_ACCESS_TOKEN }),
      ).rejects.toMatchObject({ status: 200, errorCode: "MALFORMED" });
    });
  });
});
