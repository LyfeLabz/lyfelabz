/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
// Sprint 23C adapter tests for the newly-activated `listClassRoster`
// operation. Every identifier, name, and token in this file is
// fictional per the fixture invariant. No real teacher, student,
// school, OAuth credential, or LyfeLabz-affiliated identifier is used.

import { PlatformError } from "../../../shared";
import { googleClassroomAdapter } from "./adapter";
import {
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_STUDENTS_BY_COURSE,
  createFixtureGoogleClassroomTransport,
} from "./__fixtures__/fixture-transport";
import type {
  GoogleClassroomStudentListRequest,
  GoogleClassroomStudentListResponse,
  GoogleClassroomStudentResource,
  GoogleClassroomTransport,
} from "./transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./transport";

const COURSE_PLANET_FORGE = "fixture-course-planet-forge";
const COURSE_TIDE_LOOP = "fixture-course-tide-loop";
const COURSE_SIGNAL_DRIFT = "fixture-course-signal-drift";

function stubTransport(
  overrides: Partial<GoogleClassroomTransport>,
): GoogleClassroomTransport {
  const base = createFixtureGoogleClassroomTransport();
  return { ...base, ...overrides };
}

describe("googleClassroomAdapter.listClassRoster (Sprint 23C)", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
  });

  it("returns every roster member for a single-page course", async () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const result = await googleClassroomAdapter.listClassRoster({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_TIDE_LOOP,
    });
    expect(result).toEqual([
      { providerAccountId: "fixture-student-upstream-id-201" },
    ]);
  });

  it("collects every roster member across multiple pages", async () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    // FIXTURE_STUDENTS_BY_COURSE[COURSE_PLANET_FORGE] has three
    // students; the fixture paginates at page size two, so this
    // exercises multi-page collection.
    expect(FIXTURE_STUDENTS_BY_COURSE[COURSE_PLANET_FORGE].length).toBe(3);
    const result = await googleClassroomAdapter.listClassRoster({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_PLANET_FORGE,
    });
    expect(result.map((s) => s.providerAccountId).sort()).toEqual([
      "fixture-student-upstream-id-101",
      "fixture-student-upstream-id-102",
      "fixture-student-upstream-id-103",
    ]);
  });

  it("returns a valid empty roster for a course with no students", async () => {
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const result = await googleClassroomAdapter.listClassRoster({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: COURSE_SIGNAL_DRIFT,
    });
    expect(result).toEqual([]);
  });

  it("deduplicates repeated provider account identifiers to one entry", async () => {
    const duplicated: readonly GoogleClassroomStudentResource[] = [
      { userId: "id-a", profile: { id: "fixture-dup-a" } },
      { userId: "id-b", profile: { id: "fixture-dup-b" } },
      { userId: "id-a2", profile: { id: "fixture-dup-a" } },
      { userId: "id-a3", profile: { id: "fixture-dup-a" } },
    ];
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          return { students: duplicated };
        },
      }),
    );
    const result = await googleClassroomAdapter.listClassRoster({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: "fixture-course-any",
    });
    expect(result).toEqual([
      { providerAccountId: "fixture-dup-a" },
      { providerAccountId: "fixture-dup-b" },
    ]);
  });

  it("returns a deterministic ordering regardless of upstream page order", async () => {
    const jumbled: readonly GoogleClassroomStudentResource[] = [
      { userId: "u1", profile: { id: "zzz-9" } },
      { userId: "u2", profile: { id: "aaa-1" } },
      { userId: "u3", profile: { id: "mmm-5" } },
    ];
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          return { students: jumbled };
        },
      }),
    );
    const first = await googleClassroomAdapter.listClassRoster({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: "fixture-course-any",
    });
    const second = await googleClassroomAdapter.listClassRoster({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: "fixture-course-any",
    });
    expect(first.map((s) => s.providerAccountId)).toEqual([
      "aaa-1",
      "mmm-5",
      "zzz-9",
    ]);
    expect(second).toEqual(first);
  });

  it("preserves exact string precision and performs no numeric conversion", async () => {
    const longNumeric = "9007199254740993000000000000009"; // beyond Number precision
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          return { students: [{ userId: "u", profile: { id: longNumeric } }] };
        },
      }),
    );
    const result = await googleClassroomAdapter.listClassRoster({
      accessToken: FIXTURE_ACCESS_TOKEN,
      lmsClassId: "fixture-course-any",
    });
    expect(result).toEqual([{ providerAccountId: longNumeric }]);
    expect(result[0].providerAccountId).toBe(longNumeric);
  });

  it("rejects a malformed roster entry that is missing a profile object", async () => {
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          return {
            students: [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { userId: "u" } as any,
            ],
          };
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamMalformedResponse" });
  });

  it("rejects a roster entry with a missing identifier", async () => {
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          return {
            students: [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { userId: "u", profile: {} as any },
            ],
          };
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamMalformedResponse" });
  });

  it("rejects a roster entry with a whitespace-only identifier", async () => {
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          return {
            students: [{ userId: "u", profile: { id: "   " } }],
          };
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamMalformedResponse" });
  });

  it("translates a 401 upstream failure into lms.upstreamAuthorizationFailed", async () => {
    setGoogleClassroomTransport(
      createFixtureGoogleClassroomTransport({
        failureMode: "authorization-failure",
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: COURSE_PLANET_FORGE,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("translates a 403 upstream failure into lms.upstreamAuthorizationFailed", async () => {
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(_input: GoogleClassroomStudentListRequest) {
          throw Object.assign(new Error("forbidden"), {
            status: 403,
            errorCode: "PERMISSION_DENIED",
          });
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamAuthorizationFailed" });
  });

  it("translates a 404 upstream failure into lms.upstreamResourceNotFound", async () => {
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(_input: GoogleClassroomStudentListRequest) {
          throw Object.assign(new Error("not found"), {
            status: 404,
            errorCode: "NOT_FOUND",
          });
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamResourceNotFound" });
  });

  it("translates a 429 upstream failure into lms.upstreamTemporarilyUnavailable", async () => {
    setGoogleClassroomTransport(
      createFixtureGoogleClassroomTransport({ failureMode: "rate-limited" }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: COURSE_PLANET_FORGE,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamTemporarilyUnavailable" });
  });

  it("translates a retryable 5xx failure into lms.upstreamTemporarilyUnavailable", async () => {
    setGoogleClassroomTransport(
      createFixtureGoogleClassroomTransport({
        failureMode: "temporary-unavailable",
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: COURSE_PLANET_FORGE,
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamTemporarilyUnavailable" });
  });

  it("translates a generic transport failure into lms.upstreamCallFailed", async () => {
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(_input: GoogleClassroomStudentListRequest) {
          throw new Error("transport blew up");
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamCallFailed" });
  });

  it("rejects a pagination loop where nextPageToken repeats", async () => {
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(
          input: GoogleClassroomStudentListRequest,
        ): Promise<GoogleClassroomStudentListResponse> {
          return {
            students: [
              {
                userId: `u-${input.pageToken ?? "0"}`,
                profile: { id: `id-${input.pageToken ?? "0"}` },
              },
            ],
            nextPageToken: "same-token",
          };
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamCallFailed" });
  });

  it("rejects when upstream exceeds the maximum-page bound", async () => {
    let page = 0;
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          page += 1;
          return {
            students: [
              {
                userId: `u-${page}`,
                profile: { id: `id-${page}` },
              },
            ],
            nextPageToken: `page-${page}`,
          };
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toMatchObject({ code: "lms.upstreamCallFailed" });
  });

  it("returns no partial roster after a later-page failure", async () => {
    let call = 0;
    setGoogleClassroomTransport(
      stubTransport({
        async listCourseStudents(): Promise<GoogleClassroomStudentListResponse> {
          call += 1;
          if (call === 1) {
            return {
              students: [{ userId: "u1", profile: { id: "id-1" } }],
              nextPageToken: "next-1",
            };
          }
          throw Object.assign(new Error("second page failed"), {
            status: 503,
            errorCode: "UNAVAILABLE",
          });
        },
      }),
    );
    await expect(
      googleClassroomAdapter.listClassRoster({
        accessToken: FIXTURE_ACCESS_TOKEN,
        lmsClassId: "fixture-course-any",
      }),
    ).rejects.toBeInstanceOf(PlatformError);
    expect(call).toBe(2);
  });
});
