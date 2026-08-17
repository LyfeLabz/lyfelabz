// Sprint 25 credential-refresh lifecycle (PDR-030h). Central-path integration
// coverage: the REAL resolver + REAL provider registry + REAL Google Classroom
// adapter + REAL durable token store (over an in-memory Firestore fake) +
// fixture transport. This proves the single seam every LMS callable now flows
// through actually refreshes an expired credential end to end, so course
// discovery, roster read, topic listing, and assignment publication all
// benefit automatically (Task 11) without any per-callable refresh logic.
//
// All identifiers are fictional. No real Google endpoint is contacted.

import { getLmsOAuthStateStore } from "../oauth-state/state-store";
import {
  resetGoogleClassroomConfigForTests,
  setGoogleClassroomConfig,
} from "../providers/google-classroom/config";
import {
  FIXTURE_REFRESH_TOKEN,
  FIXTURE_REFRESHED_ACCESS_TOKEN,
  createFixtureGoogleClassroomTransport,
} from "../providers/google-classroom/__fixtures__/fixture-transport";
import {
  resetGoogleClassroomTransportForTests,
  setGoogleClassroomTransport,
} from "../providers/google-classroom/transport";
import { FakeFirestore } from "../shared/firestore-fake-for-tests";
import { FirestoreLmsTokenStore } from "./firestore-token-store";
import { resolveLiveCredential } from "./credential-resolver";
import { setLmsTokenStore, type LmsTokenBundle } from "./token-store";

const FIXTURE_CONFIG = {
  clientId: "fixture-oauth-client-id",
  clientSecret: "fixture-oauth-client-secret-never-real",
  redirectUri: "https://fixture.example.invalid/lms-callback",
} as const;

// The four scopes the live certification connection actually holds. Notably
// `classroom.coursework.me` is absent (Sprint 25 B9 scope correction) and must
// stay absent across a refresh.
const CONNECTION_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.topics.readonly",
];

function bundle(overrides: Partial<LmsTokenBundle> = {}): LmsTokenBundle {
  return {
    providerId: "googleClassroom",
    teacherId: "cert-teacher-001",
    accessToken: "fixture-access-token-stale",
    refreshToken: FIXTURE_REFRESH_TOKEN,
    scopes: CONNECTION_SCOPES,
    expiresAtEpochMs: Date.now() + 60 * 60 * 1000,
    upstreamAccountIdentifier: "fixture-upstream-id",
    ...overrides,
  };
}

describe("credential refresh central path (PDR-030h integration)", () => {
  let store: FirestoreLmsTokenStore;

  beforeEach(() => {
    store = new FirestoreLmsTokenStore(new FakeFirestore() as never);
    setLmsTokenStore(store);
    setGoogleClassroomTransport(createFixtureGoogleClassroomTransport());
    setGoogleClassroomConfig(FIXTURE_CONFIG);
  });

  afterEach(() => {
    resetGoogleClassroomTransportForTests();
    resetGoogleClassroomConfigForTests();
  });

  it("self-heals an expired access token: refresh -> persist -> fresh token, same tokenRef", async () => {
    const ref = await store.store(bundle({ expiresAtEpochMs: Date.now() - 1000 }));

    const live = await resolveLiveCredential(ref);

    expect(live.accessToken).toBe(FIXTURE_REFRESHED_ACCESS_TOKEN);
    // tokenRef is stable: the SAME reference now resolves to the fresh token.
    const reResolved = await store.resolve(ref);
    expect(reResolved.accessToken).toBe(FIXTURE_REFRESHED_ACCESS_TOKEN);
  });

  it("does not refresh a comfortably-valid token", async () => {
    const transport = createFixtureGoogleClassroomTransport();
    setGoogleClassroomTransport(transport);
    const ref = await store.store(
      bundle({ expiresAtEpochMs: Date.now() + 60 * 60 * 1000 }),
    );

    const live = await resolveLiveCredential(ref);

    expect(live.accessToken).toBe("fixture-access-token-stale");
    expect(transport.log().accessTokenRefreshes).toBe(0);
  });

  it("preserves the refresh token across a refresh (Google omits a new one)", async () => {
    const ref = await store.store(bundle({ expiresAtEpochMs: Date.now() - 1000 }));
    await resolveLiveCredential(ref);
    const reResolved = await store.resolve(ref);
    expect(reResolved.refreshToken).toBe(FIXTURE_REFRESH_TOKEN);
  });

  it("preserves the exact four connection scopes across a refresh", async () => {
    const ref = await store.store(bundle({ expiresAtEpochMs: Date.now() - 1000 }));
    await resolveLiveCredential(ref);
    const reResolved = await store.resolve(ref);
    expect(reResolved.scopes).toEqual(CONNECTION_SCOPES);
  });

  it("keeps classroom.coursework.me absent after a refresh", async () => {
    const ref = await store.store(bundle({ expiresAtEpochMs: Date.now() - 1000 }));
    await resolveLiveCredential(ref);
    const reResolved = await store.resolve(ref);
    expect(reResolved.scopes).not.toContain(
      "https://www.googleapis.com/auth/classroom.coursework.me",
    );
  });

  it("advances the stored expiry to a later timestamp than before", async () => {
    const priorExpiry = Date.now() - 1000;
    const ref = await store.store(bundle({ expiresAtEpochMs: priorExpiry }));
    await resolveLiveCredential(ref);
    const reResolved = await store.resolve(ref);
    expect(reResolved.expiresAtEpochMs).toBeGreaterThan(priorExpiry);
  });

  it("does not mint any OAuth state during a refresh (refresh is not an authorization event)", async () => {
    const stateStore = getLmsOAuthStateStore();
    const issueSpy = jest.spyOn(stateStore, "issue");
    const ref = await store.store(bundle({ expiresAtEpochMs: Date.now() - 1000 }));
    await resolveLiveCredential(ref);
    expect(issueSpy).not.toHaveBeenCalled();
    issueSpy.mockRestore();
  });
});
