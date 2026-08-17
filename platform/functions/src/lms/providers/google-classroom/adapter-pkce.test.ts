// Sprint 23B security completion: PKCE + server-side state coverage
// for the Google Classroom adapter.
//
// Every fixture is fictional.

import { createHash } from "node:crypto";

import { PlatformError } from "../../../shared";
import {
  getLmsOAuthStateStore,
  LMS_OAUTH_STATE_ERROR_CODES,
  resetLmsOAuthStateStoreForTests,
} from "../../oauth-state/state-store";

import { googleClassroomAdapter, GOOGLE_CLASSROOM_PUBLICATION_SCOPES } from "./adapter";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
  type GoogleClassroomConfig,
} from "./config";
import {
  FIXTURE_AUTHORIZATION_CODE,
  createFixtureGoogleClassroomTransport,
} from "./__fixtures__/fixture-transport";
import type {
  GoogleAuthorizationCodeExchangeRequest,
  GoogleAuthorizationCodeExchangeResponse,
  GoogleClassroomTransport,
} from "./transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "./transport";

const FIXTURE_CONFIG: GoogleClassroomConfig = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
};

const FIXTURE_TEACHER_ID = "fixture-teacher-id-alpha";

function sha256Base64Url(input: string): string {
  return createHash("sha256")
    .update(input)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// A capturing transport wrapper so the PKCE tests can inspect the
// exact fields the adapter forwards to `exchangeAuthorizationCode`
// without pulling in the entire fixture surface.
type Captured = { last?: GoogleAuthorizationCodeExchangeRequest };
function makeCapturingTransport(): {
  readonly transport: GoogleClassroomTransport;
  readonly capture: Captured;
} {
  const inner = createFixtureGoogleClassroomTransport();
  const capture: Captured = {};
  const transport: GoogleClassroomTransport = {
    ...inner,
    exchangeAuthorizationCode(
      req: GoogleAuthorizationCodeExchangeRequest,
    ): Promise<GoogleAuthorizationCodeExchangeResponse> {
      capture.last = req;
      return inner.exchangeAuthorizationCode(req);
    },
  };
  return { transport, capture };
}

describe("Google Classroom adapter - PKCE + server-side state", () => {
  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
    resetLmsOAuthStateStoreForTests();
  });

  it("beginOAuth authorization URL includes state, code_challenge, and code_challenge_method=S256", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    const url = new URL(authorization.authorizationUrl);
    expect(url.searchParams.get("state")).toBe(authorization.state);
    const challenge = url.searchParams.get("code_challenge");
    expect(challenge).not.toBeNull();
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // Plain PKCE is explicitly forbidden by the sprint contract.
    expect(url.searchParams.get("code_challenge_method")).not.toBe("plain");
  });

  it("beginOAuth authorization URL does not carry the code_verifier", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    const url = new URL(authorization.authorizationUrl);
    expect(url.searchParams.get("code_verifier")).toBeNull();
    // Also verify no verifier-looking bytes leaked into the URL.
    expect(authorization.authorizationUrl).not.toContain("code_verifier=");
  });

  it("completeOAuth supplies the paired code_verifier to the transport at token exchange", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    const { transport, capture } = makeCapturingTransport();
    setGoogleClassroomTransport(transport);
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    await googleClassroomAdapter.completeOAuth({
      code: FIXTURE_AUTHORIZATION_CODE,
      state: authorization.state,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    expect(capture.last).toBeDefined();
    expect(capture.last?.codeVerifier).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(capture.last?.code).toBe(FIXTURE_AUTHORIZATION_CODE);
    expect(capture.last?.redirectUri).toBe(FIXTURE_CONFIG.redirectUri);
    // The challenge advertised in beginOAuth's URL matches the SHA-256
    // of the verifier the adapter forwarded at completion (end-to-end
    // PKCE binding).
    const url = new URL(authorization.authorizationUrl);
    expect(url.searchParams.get("code_challenge")).toBe(
      sha256Base64Url(capture.last?.codeVerifier ?? ""),
    );
  });

  it("completeOAuth is single-use: a replay of the same state is rejected before the transport runs", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    const { transport, capture } = makeCapturingTransport();
    setGoogleClassroomTransport(transport);
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    await googleClassroomAdapter.completeOAuth({
      code: FIXTURE_AUTHORIZATION_CODE,
      state: authorization.state,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    capture.last = undefined;
    let observed: unknown;
    try {
      await googleClassroomAdapter.completeOAuth({
        code: FIXTURE_AUTHORIZATION_CODE,
        state: authorization.state,
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
    } catch (err) {
      observed = err;
    }
    expect(observed).toBeInstanceOf(PlatformError);
    expect((observed as PlatformError).code).toBe(
      LMS_OAUTH_STATE_ERROR_CODES.consumed,
    );
    expect(capture.last).toBeUndefined();
  });

  it("completeOAuth rejects an unknown state before any code exchange", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    const { transport, capture } = makeCapturingTransport();
    setGoogleClassroomTransport(transport);
    let observed: unknown;
    try {
      await googleClassroomAdapter.completeOAuth({
        code: FIXTURE_AUTHORIZATION_CODE,
        state: "0".repeat(64),
        redirectUri: FIXTURE_CONFIG.redirectUri,
      });
    } catch (err) {
      observed = err;
    }
    expect((observed as PlatformError).code).toBe(
      LMS_OAUTH_STATE_ERROR_CODES.notFound,
    );
    expect(capture.last).toBeUndefined();
  });

  it("beginOAuth without intent requests only the initial scope set", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    const url = new URL(authorization.authorizationUrl);
    const scope = url.searchParams.get("scope") ?? "";
    for (const pubScope of GOOGLE_CLASSROOM_PUBLICATION_SCOPES) {
      expect(scope).not.toContain(pubScope);
    }
    expect(scope).toContain("classroom.courses.readonly");
    expect(scope).toContain("classroom.rosters.readonly");
  });

  it("beginOAuth with publication intent requests both scope sets", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
      intent: "publication",
    });
    const url = new URL(authorization.authorizationUrl);
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("classroom.courses.readonly");
    expect(scope).toContain("classroom.rosters.readonly");
    for (const pubScope of GOOGLE_CLASSROOM_PUBLICATION_SCOPES) {
      expect(scope).toContain(pubScope);
    }
    // Teacher-side courseWork.create requires the teacher-scoped write scope,
    // not the caller-scoped `classroom.coursework.me` (disproved by live B9
    // certification: Google granted `.me`, courseWork.create still 403'd).
    expect(scope).toContain("classroom.coursework.students");
    expect(scope).toContain("classroom.topics.readonly");
    expect(scope).not.toContain("classroom.coursework.me");
  });

  it("beginOAuth with publication intent stores the publication intent in state", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
      intent: "publication",
    });
    const binding = await getLmsOAuthStateStore().peek(authorization.state);
    expect(binding?.intent).toBe("publication");
  });

  it("completeOAuth rejects a state issued against a different redirect URI", async () => {
    setGoogleClassroomConfig(FIXTURE_CONFIG);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    const authorization = await googleClassroomAdapter.beginOAuth({
      teacherId: FIXTURE_TEACHER_ID,
      redirectUri: FIXTURE_CONFIG.redirectUri,
    });
    let observed: unknown;
    try {
      await googleClassroomAdapter.completeOAuth({
        code: FIXTURE_AUTHORIZATION_CODE,
        state: authorization.state,
        redirectUri: "https://fixture.example.invalid/other-callback",
      });
    } catch (err) {
      observed = err;
    }
    expect((observed as PlatformError).code).toBe(
      LMS_OAUTH_STATE_ERROR_CODES.redirectMismatch,
    );
  });
});
