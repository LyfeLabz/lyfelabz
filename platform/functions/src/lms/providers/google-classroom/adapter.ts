import { PlatformError, type LmsProviderId } from "../../../shared";
import { getLmsOAuthStateStore } from "../../oauth-state/state-store";
import type {
  LmsDiscoveredClass,
  LmsOAuthAuthorizationRequest,
  LmsOAuthGrant,
  LmsProviderAdapter,
  LmsPublishedAssignment,
  LmsRosterStudent,
  LmsTopic,
} from "../provider";
import { getGoogleClassroomConfig } from "./config";
import {
  GoogleClassroomHttpsError,
  getGoogleClassroomTransport,
  type GoogleClassroomCourseResource,
} from "./transport";

// Google Classroom adapter. Sprint 23A shipped this file as a
// scaffolded set of `PlatformError` rejects; Sprint 23B activates the
// connection lifecycle and course discovery capabilities per PDR-020c
// and the Sprint 23B specification. Sprint 25 Phase 1 activates the
// remaining two deferred operations.
//
// Active operations:
//
//   - beginOAuth          (Sprint 23B)
//   - completeOAuth       (Sprint 23B)
//   - revokeGrant         (Sprint 23B)
//   - listTeacherClasses  (Sprint 23B)
//   - fetchClass          (Sprint 23B)
//   - listClassRoster     (Sprint 23C)
//   - listClassTopics     (Sprint 25 Phase 1)
//   - publishAssignment   (Sprint 25 Phase 1)
//
// Vendor neutrality (PDR-020f): every Google-specific concept lives
// inside this file and the `transport.ts` / `config.ts` /
// `config-firebase.ts` siblings. The vendor-neutral core sees only
// `LmsProviderAdapter`.

const GOOGLE_CLASSROOM_PROVIDER_ID: LmsProviderId = "googleClassroom";
const GOOGLE_CLASSROOM_DISPLAY_NAME = "Google Classroom";

const GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

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

// Extract the (status, upstreamCode) pair from any Google-shaped
// upstream error. Recognises both the production HTTPS error
// (`GoogleClassroomHttpsError`) and the in-memory fixture's upstream
// error (`GoogleClassroomFixtureUpstreamError`), plus any generic
// error that exposes a numeric `status` and a string `errorCode` or
// `upstreamCode`. Duck-typing keeps the fixture module out of the
// production adapter's dependency graph.
function readUpstreamShape(
  err: unknown,
): { status?: number; code?: string } {
  if (err instanceof GoogleClassroomHttpsError) {
    return { status: err.status, code: err.upstreamCode };
  }
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    const status =
      typeof rec.status === "number" ? rec.status : undefined;
    const code =
      typeof rec.upstreamCode === "string"
        ? rec.upstreamCode
        : typeof rec.errorCode === "string"
          ? rec.errorCode
          : undefined;
    if (status !== undefined || code !== undefined) {
      return { status, code };
    }
  }
  return {};
}

// Translate a Google-specific upstream error into a stable
// vendor-neutral `PlatformError` code. The vendor-neutral core (registry,
// callables, mirror record) sees only `PlatformError`; the concrete
// upstream HTTP status and Google error code never escape this file.
function translateUpstreamError(err: unknown, op: string): PlatformError {
  if (err instanceof PlatformError) return err;
  const { status, code } = readUpstreamShape(err);
  if (status === 401) {
    return new PlatformError(
      "lms.upstreamAuthorizationFailed",
      `Google Classroom rejected the upstream ${op} call as unauthorized (status 401).`,
    );
  }
  if (status === 403) {
    // A 403 with INSUFFICIENT_SCOPE signals that the access token lacks the
    // coursework publication scope. This is distinct from a general permission
    // denial: the caller has a valid connection but needs incremental OAuth
    // consent (PDR-030c). The callable treats this as non-terminal.
    if (code === "INSUFFICIENT_SCOPE" || code === "ACCESS_TOKEN_SCOPE_INSUFFICIENT") {
      return new PlatformError(
        "lms.insufficientScope",
        `Google Classroom requires additional OAuth scopes for ${op}.`,
      );
    }
    return new PlatformError(
      "lms.upstreamAuthorizationFailed",
      `Google Classroom rejected the upstream ${op} call as unauthorized (status 403).`,
    );
  }
  if (status === 400 && code === "invalid_grant") {
    return new PlatformError(
      "lms.upstreamAuthorizationFailed",
      `Google Classroom rejected the ${op} request with invalid_grant (status ${status}).`,
    );
  }
  if (status === 404) {
    return new PlatformError(
      "lms.upstreamResourceNotFound",
      `Google Classroom reports the target resource for ${op} does not exist (status 404).`,
    );
  }
  if (status === 429 || status === 503) {
    return new PlatformError(
      "lms.upstreamTemporarilyUnavailable",
      `Google Classroom is temporarily unavailable for ${op} (status ${status}).`,
    );
  }
  if (code === "MALFORMED") {
    return new PlatformError(
      "lms.upstreamMalformedResponse",
      `Google Classroom returned a malformed response for ${op}.`,
    );
  }
  if (status !== undefined) {
    return new PlatformError(
      "lms.upstreamCallFailed",
      `Google Classroom ${op} failed with status ${status}.`,
    );
  }
  return new PlatformError(
    "lms.upstreamCallFailed",
    `Google Classroom ${op} failed unexpectedly.`,
  );
}

function toDiscoveredClass(
  course: GoogleClassroomCourseResource,
): LmsDiscoveredClass {
  return {
    lmsClassId: course.id,
    name: course.name,
    ...(course.section !== undefined ? { section: course.section } : {}),
    ownerUpstreamAccountIdentifier: course.ownerId,
  };
}

function isCourseActive(course: GoogleClassroomCourseResource): boolean {
  // Google Classroom returns courses that are ACTIVE, ARCHIVED,
  // PROVISIONED, DECLINED, or SUSPENDED. Only ACTIVE courses are
  // surfaced as discovery candidates; the others are not useful for
  // import (an ARCHIVED course cannot receive coursework at all).
  return course.courseState === "ACTIVE" || course.courseState === undefined;
}

export const googleClassroomAdapter: LmsProviderAdapter = {
  providerId: GOOGLE_CLASSROOM_PROVIDER_ID,
  displayName: GOOGLE_CLASSROOM_DISPLAY_NAME,

  async beginOAuth(input): Promise<LmsOAuthAuthorizationRequest> {
    // Build the authorization URL locally. Google's OAuth 2.0
    // authorization endpoint is idempotent and stateless from our
    // side; no upstream call is required until the completion
    // callable exchanges the code.
    //
    // Sprint 23B security completion: the opaque `state` value and the
    // paired PKCE `code_verifier` / `code_challenge` are issued by the
    // vendor-neutral OAuth state store. The verifier is retained
    // server-side; only the state and the S256 challenge appear in
    // the authorization URL. The store binds the record to
    // (teacherId, providerId, redirectUri) so the completion callable
    // can enforce every binding at consume time.
    let clientId: string;
    let redirectUri: string;
    try {
      const config = getGoogleClassroomConfig();
      clientId = config.clientId;
      // Prefer the request-supplied redirectUri per PDR-020c so the
      // client can pin exactly which callback URL it registered; the
      // configured redirectUri is used as the default only.
      redirectUri = input.redirectUri || config.redirectUri;
    } catch (err) {
      throw translateUpstreamError(err, "beginOAuth");
    }

    if (!clientId) {
      throw new PlatformError(
        "lms.googleClassroomConfigMissingClientId",
        "The Google Classroom OAuth client id is not configured. Set the GOOGLE_CLASSROOM_CLIENT_ID parameter before activating the connection surface.",
      );
    }
    if (!redirectUri) {
      throw new PlatformError(
        "lms.googleClassroomConfigMissingRedirectUri",
        "The Google Classroom OAuth redirect URI is not configured.",
      );
    }

    const { state, codeChallenge } = await getLmsOAuthStateStore().issue({
      teacherId: input.teacherId,
      providerId: GOOGLE_CLASSROOM_PROVIDER_ID,
      redirectUri,
    });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      scope: GOOGLE_CLASSROOM_INITIAL_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      login_hint: "",
    });
    // login_hint is intentionally empty and stripped so the parameter
    // string is deterministic in tests but Google still sees an
    // omitted value.
    params.delete("login_hint");

    return {
      authorizationUrl: `${GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT}?${params.toString()}`,
      state,
    };
  },

  async completeOAuth(input): Promise<LmsOAuthGrant> {
    let transport;
    try {
      transport = getGoogleClassroomTransport();
    } catch (err) {
      throw translateUpstreamError(err, "completeOAuth");
    }
    // Atomically consume the OAuth state record and retrieve the
    // paired PKCE verifier. The consume enforces single-use, the
    // TTL, provider binding, and redirect binding; the teacher
    // binding is enforced by the callable BEFORE this method runs
    // (the adapter does not receive the teacherId per the
    // vendor-neutral provider interface).
    const stateConsume = await getLmsOAuthStateStore().consume({
      state: input.state,
      expectedProviderId: GOOGLE_CLASSROOM_PROVIDER_ID,
      expectedRedirectUri: input.redirectUri,
    });
    try {
      const exchange = await transport.exchangeAuthorizationCode({
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: stateConsume.codeVerifier,
      });
      // Read the caller's Classroom user profile so the vendor-neutral
      // grant record can carry `upstreamAccountIdentifier`. The read
      // requires no additional scope beyond what the initial classroom
      // scopes already grant. Amendment §6.1 personal-account
      // misconnection mitigation depends on this identifier.
      const profile = await transport.getUserProfileMe({
        accessToken: exchange.access_token,
      });
      const scopes = exchange.scope
        .split(/\s+/)
        .filter((s) => s.length > 0);
      const grant: LmsOAuthGrant = {
        accessToken: exchange.access_token,
        scopes,
        ...(exchange.refresh_token !== undefined
          ? { refreshToken: exchange.refresh_token }
          : {}),
        ...(exchange.expires_in !== undefined
          ? { expiresInSeconds: exchange.expires_in }
          : {}),
        upstreamAccountIdentifier: profile.id,
      };
      return grant;
    } catch (err) {
      throw translateUpstreamError(err, "completeOAuth");
    }
  },

  async revokeGrant(input): Promise<void> {
    let transport;
    try {
      transport = getGoogleClassroomTransport();
    } catch (err) {
      throw translateUpstreamError(err, "revokeGrant");
    }
    // Prefer the refresh token: revoking a refresh token invalidates
    // every access token minted from it (Google contract). Falls back
    // to the access token if no refresh token is available.
    const token = input.refreshToken ?? input.accessToken;
    try {
      await transport.revokeToken({ token });
    } catch (err) {
      throw translateUpstreamError(err, "revokeGrant");
    }
  },

  async listTeacherClasses(input): Promise<readonly LmsDiscoveredClass[]> {
    let transport;
    try {
      transport = getGoogleClassroomTransport();
    } catch (err) {
      throw translateUpstreamError(err, "listTeacherClasses");
    }
    const collected: LmsDiscoveredClass[] = [];
    let pageToken: string | undefined = undefined;
    // Bounded pagination: Google returns at most a few hundred courses
    // for a real teacher; this bound is a defense against a runaway
    // upstream that never stops handing back page tokens.
    const MAX_PAGES = 25;
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await transport.listTeacherCourses({
          accessToken: input.accessToken,
          ...(pageToken !== undefined ? { pageToken } : {}),
        });
        for (const course of response.courses ?? []) {
          if (isCourseActive(course)) {
            collected.push(toDiscoveredClass(course));
          }
        }
        if (!response.nextPageToken) break;
        pageToken = response.nextPageToken;
      }
    } catch (err) {
      throw translateUpstreamError(err, "listTeacherClasses");
    }
    return collected;
  },

  async fetchClass(input): Promise<LmsDiscoveredClass> {
    let transport;
    try {
      transport = getGoogleClassroomTransport();
    } catch (err) {
      throw translateUpstreamError(err, "fetchClass");
    }
    try {
      const course = await transport.fetchCourse({
        accessToken: input.accessToken,
        courseId: input.lmsClassId,
      });
      return toDiscoveredClass(course);
    } catch (err) {
      throw translateUpstreamError(err, "fetchClass");
    }
  },

  async listClassRoster(input): Promise<readonly LmsRosterStudent[]> {
    let transport;
    try {
      transport = getGoogleClassroomTransport();
    } catch (err) {
      throw translateUpstreamError(err, "listClassRoster");
    }
    // First-occurrence dedup, exact string preservation, and stable
    // ordering per Sprint 23C specification. The Map is keyed by the
    // canonical Classroom student account identifier (`profile.id`) so
    // duplicate roster entries collapse to the first valid occurrence.
    const collected = new Map<string, LmsRosterStudent>();
    let pageToken: string | undefined = undefined;
    // Bounded pagination: Google Classroom courses have realistic
    // ceilings well below this bound. The defensive bound rejects a
    // runaway upstream that never stops handing back page tokens.
    const MAX_PAGES = 50;
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await transport.listCourseStudents({
          accessToken: input.accessToken,
          courseId: input.lmsClassId,
          ...(pageToken !== undefined ? { pageToken } : {}),
        });
        for (const student of response.students ?? []) {
          if (
            student === null ||
            typeof student !== "object" ||
            student.profile === null ||
            typeof student.profile !== "object"
          ) {
            throw new PlatformError(
              "lms.upstreamMalformedResponse",
              "Google Classroom returned a malformed roster entry for listClassRoster.",
            );
          }
          const providerAccountId = student.profile.id;
          if (
            typeof providerAccountId !== "string" ||
            providerAccountId.length === 0 ||
            providerAccountId.trim().length === 0
          ) {
            throw new PlatformError(
              "lms.upstreamMalformedResponse",
              "Google Classroom returned a roster entry with a missing or empty identifier for listClassRoster.",
            );
          }
          if (!collected.has(providerAccountId)) {
            collected.set(providerAccountId, { providerAccountId });
          }
        }
        if (!response.nextPageToken) {
          // Deterministic stable ordering: sort by the opaque
          // identifier's byte-exact string value so identical rosters
          // always produce identical engine planning input.
          const sorted = Array.from(collected.values()).sort((a, b) =>
            a.providerAccountId < b.providerAccountId
              ? -1
              : a.providerAccountId > b.providerAccountId
                ? 1
                : 0,
          );
          return sorted;
        }
        if (
          typeof response.nextPageToken !== "string" ||
          response.nextPageToken.length === 0
        ) {
          throw new PlatformError(
            "lms.upstreamMalformedResponse",
            "Google Classroom returned a malformed nextPageToken for listClassRoster.",
          );
        }
        if (response.nextPageToken === pageToken) {
          // Pagination loop guard: upstream must advance the cursor.
          throw new PlatformError(
            "lms.upstreamCallFailed",
            "Google Classroom returned a repeated nextPageToken for listClassRoster.",
          );
        }
        pageToken = response.nextPageToken;
      }
    } catch (err) {
      throw translateUpstreamError(err, "listClassRoster");
    }
    // Ran out the maximum-page bound. Reject the entire operation
    // rather than return a partial roster masquerading as successful.
    throw new PlatformError(
      "lms.upstreamCallFailed",
      "Google Classroom listClassRoster exceeded the maximum-page bound.",
    );
  },

  async listClassTopics(input): Promise<readonly LmsTopic[]> {
    let transport;
    try {
      transport = getGoogleClassroomTransport();
    } catch (err) {
      throw translateUpstreamError(err, "listClassTopics");
    }
    const collected: LmsTopic[] = [];
    let pageToken: string | undefined = undefined;
    // Bounded pagination: topics per course are realistic in count; this
    // bound defends against a runaway upstream cursor loop.
    const MAX_PAGES = 25;
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await transport.listCourseTopics({
          accessToken: input.accessToken,
          courseId: input.lmsClassId,
          ...(pageToken !== undefined ? { pageToken } : {}),
        });
        for (const topic of response.topic ?? []) {
          if (
            typeof topic.topicId !== "string" ||
            topic.topicId.trim().length === 0 ||
            typeof topic.name !== "string" ||
            topic.name.trim().length === 0
          ) {
            throw new PlatformError(
              "lms.upstreamMalformedResponse",
              "Google Classroom returned a malformed topic entry for listClassTopics.",
            );
          }
          collected.push({ lmsTopicId: topic.topicId, name: topic.name });
        }
        if (!response.nextPageToken) return collected;
        if (
          typeof response.nextPageToken !== "string" ||
          response.nextPageToken.length === 0
        ) {
          throw new PlatformError(
            "lms.upstreamMalformedResponse",
            "Google Classroom returned a malformed nextPageToken for listClassTopics.",
          );
        }
        if (response.nextPageToken === pageToken) {
          // Pagination loop guard, consistent with listClassRoster: a
          // repeated cursor means the upstream is not advancing. Reject
          // rather than collect the same page (and its duplicate topics)
          // up to the page bound.
          throw new PlatformError(
            "lms.upstreamCallFailed",
            "Google Classroom returned a repeated nextPageToken for listClassTopics.",
          );
        }
        pageToken = response.nextPageToken;
      }
    } catch (err) {
      throw translateUpstreamError(err, "listClassTopics");
    }
    // Ran out the page bound with a cursor still outstanding. Reject the
    // whole operation rather than return a truncated topic list that
    // looks complete, matching the listClassRoster contract.
    throw new PlatformError(
      "lms.upstreamCallFailed",
      "Google Classroom listClassTopics exceeded the maximum-page bound.",
    );
  },

  async publishAssignment(input): Promise<LmsPublishedAssignment> {
    let transport;
    try {
      transport = getGoogleClassroomTransport();
    } catch (err) {
      throw translateUpstreamError(err, "publishAssignment");
    }
    // Bounded, AbortController-backed timeout (§2.3 Correction 3). A hang
    // on the coursework POST must not consume the entire Cloud Functions
    // execution budget. The controller's signal is threaded into the
    // transport so a real fetch is genuinely cancelled when the deadline
    // fires; the accompanying race guarantees this adapter's promise
    // settles even if a transport implementation ignores the signal. The
    // timer is always cleared in `finally`, so no timer handle survives a
    // resolved, rejected, or timed-out call.
    const PUBLICATION_TIMEOUT_MS = 30_000;
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        // Cancel the in-flight request, then reject the race with the
        // approved sanitized failure. The raw provider response, if one
        // ever arrives after this point, is discarded by the race.
        controller.abort();
        reject(
          new PlatformError(
            "lms.upstreamCallFailed",
            "Google Classroom publishAssignment exceeded the 30s timeout.",
          ),
        );
      }, PUBLICATION_TIMEOUT_MS);
    });
    // Start the work with the abort signal attached. Swallow any late
    // rejection (e.g. the abort error) on the work promise so a post-race
    // settlement never surfaces as an unhandled rejection.
    const workPromise = transport.createCourseWork({
      accessToken: input.accessToken,
      courseId: input.lmsClassId,
      title: input.title,
      ...(input.instructions !== undefined
        ? { description: input.instructions }
        : {}),
      link: input.lyfelabzAssignmentUrl,
      ...(input.lmsTopicId !== undefined ? { topicId: input.lmsTopicId } : {}),
      signal: controller.signal,
    });
    workPromise.catch(() => undefined);
    try {
      const result = await Promise.race([workPromise, timeoutPromise]);
      if (typeof result.id !== "string" || result.id.trim().length === 0) {
        throw new PlatformError(
          "lms.upstreamMalformedResponse",
          "Google Classroom returned a coursework resource with a missing or empty id.",
        );
      }
      return {
        lmsAssignmentId: result.id,
        ...(typeof result.alternateLink === "string" && result.alternateLink.length > 0
          ? { lmsAssignmentUrl: result.alternateLink }
          : {}),
      };
    } catch (err) {
      throw translateUpstreamError(err, "publishAssignment");
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  },
};
