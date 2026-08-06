// Sprint 23B security completion: LmsOAuthStateStore coverage.
//
// Every fixture is fictional. No real teacher, provider account, or
// credential appears in this file.

import { createHash } from "node:crypto";

import type { PlatformError, LmsProviderId } from "../../shared";

import {
  InProcessLmsOAuthStateStore,
  LMS_OAUTH_STATE_ERROR_CODES,
  LMS_OAUTH_STATE_TTL_MS_FOR_TESTS,
  derivePkceS256Challenge,
  getLmsOAuthStateStore,
  resetLmsOAuthStateStoreForTests,
  setLmsOAuthStateStore,
  withLmsOAuthStateStore,
} from "./state-store";

const FIXTURE_TEACHER_ID = "fixture-teacher-id-alpha";
const FIXTURE_OTHER_TEACHER_ID = "fixture-teacher-id-beta";
const FIXTURE_PROVIDER: LmsProviderId = "googleClassroom";
const FIXTURE_REDIRECT_URI = "https://fixture.example.invalid/lms-callback";

function base64UrlDecode(value: string): Buffer {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

describe("InProcessLmsOAuthStateStore", () => {
  afterEach(() => {
    resetLmsOAuthStateStoreForTests();
  });

  describe("issue", () => {
    it("returns a 64-hex-character state value (256 bits of entropy)", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      expect(state).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns a base64url PKCE challenge with no padding of the expected S256 length", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { codeChallenge } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      // SHA-256 digest is 32 bytes; base64url without padding = 43 chars.
      expect(codeChallenge).toHaveLength(43);
      expect(codeChallenge).toMatch(/^[A-Za-z0-9\-_]+$/);
      expect(codeChallenge).not.toContain("=");
    });

    it("mints cryptographically distinct state and challenge on every call", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const seenStates = new Set<string>();
      const seenChallenges = new Set<string>();
      for (let i = 0; i < 64; i += 1) {
        const issued = await store.issue({
          teacherId: FIXTURE_TEACHER_ID,
          providerId: FIXTURE_PROVIDER,
          redirectUri: FIXTURE_REDIRECT_URI,
        });
        expect(seenStates.has(issued.state)).toBe(false);
        expect(seenChallenges.has(issued.codeChallenge)).toBe(false);
        seenStates.add(issued.state);
        seenChallenges.add(issued.codeChallenge);
      }
    });

    it("does not return the verifier in the public issue result", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const result = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      expect(Object.keys(result).sort()).toEqual(["codeChallenge", "state"]);
      expect((result as unknown as Record<string, unknown>).codeVerifier).toBeUndefined();
    });

    it("defaults intent to initialConnect when absent", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const binding = await store.peek(state);
      expect(binding?.intent).toBe("initialConnect");
    });

    it("stores the provided intent when publication is specified", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
        intent: "publication",
      });
      const binding = await store.peek(state);
      expect(binding?.intent).toBe("publication");
    });

    it("rejects missing teacherId, providerId, or redirectUri", async () => {
      const store = new InProcessLmsOAuthStateStore();
      await expect(
        store.issue({
          teacherId: "",
          providerId: FIXTURE_PROVIDER,
          redirectUri: FIXTURE_REDIRECT_URI,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.invalidInput });
      await expect(
        store.issue({
          teacherId: FIXTURE_TEACHER_ID,
          providerId: "" as LmsProviderId,
          redirectUri: FIXTURE_REDIRECT_URI,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.invalidInput });
      await expect(
        store.issue({
          teacherId: FIXTURE_TEACHER_ID,
          providerId: FIXTURE_PROVIDER,
          redirectUri: "",
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.invalidInput });
    });
  });

  describe("peek", () => {
    it("returns the binding fields but never the verifier", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const binding = await store.peek(state);
      expect(binding).not.toBeNull();
      expect(binding?.teacherId).toBe(FIXTURE_TEACHER_ID);
      expect(binding?.providerId).toBe(FIXTURE_PROVIDER);
      expect(binding?.redirectUri).toBe(FIXTURE_REDIRECT_URI);
      expect(binding?.consumed).toBe(false);
      expect(
        (binding as unknown as Record<string, unknown>).codeVerifier,
      ).toBeUndefined();
    });

    it("exposes intent on the returned binding", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state: s1 } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const { state: s2 } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
        intent: "publication",
      });
      expect((await store.peek(s1))?.intent).toBe("initialConnect");
      expect((await store.peek(s2))?.intent).toBe("publication");
    });

    it("returns null for a missing or empty state value", async () => {
      const store = new InProcessLmsOAuthStateStore();
      expect(await store.peek("does-not-exist")).toBeNull();
      expect(await store.peek("")).toBeNull();
    });

    it("reports the consumed flag after consume", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      await store.consume({
        state,
        expectedProviderId: FIXTURE_PROVIDER,
        expectedRedirectUri: FIXTURE_REDIRECT_URI,
      });
      const binding = await store.peek(state);
      expect(binding?.consumed).toBe(true);
    });

    it("uses the documented expiration window", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const before = Date.now();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const after = Date.now();
      const binding = await store.peek(state);
      expect(binding?.expiresAtEpochMs).toBeGreaterThanOrEqual(
        before + LMS_OAUTH_STATE_TTL_MS_FOR_TESTS,
      );
      expect(binding?.expiresAtEpochMs).toBeLessThanOrEqual(
        after + LMS_OAUTH_STATE_TTL_MS_FOR_TESTS,
      );
    });
  });

  describe("consume", () => {
    it("returns the paired verifier + teacher id and the challenge matches SHA-256(verifier)", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state, codeChallenge } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const consumed = await store.consume({
        state,
        expectedProviderId: FIXTURE_PROVIDER,
        expectedRedirectUri: FIXTURE_REDIRECT_URI,
      });
      expect(consumed.teacherId).toBe(FIXTURE_TEACHER_ID);
      expect(consumed.codeVerifier).toMatch(/^[A-Za-z0-9\-_]{43}$/);
      // Verifier is 43 base64url chars = 32 raw bytes = 256 bits.
      expect(base64UrlDecode(consumed.codeVerifier)).toHaveLength(32);
      // Challenge is base64url(sha256(verifier)) with no padding.
      const expectedChallenge = createHash("sha256")
        .update(consumed.codeVerifier)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      expect(codeChallenge).toBe(expectedChallenge);
      expect(codeChallenge).toBe(derivePkceS256Challenge(consumed.codeVerifier));
    });

    it("rejects an unknown state with lms.oauthStateNotFound", async () => {
      const store = new InProcessLmsOAuthStateStore();
      await expect(
        store.consume({
          state: "0".repeat(64),
          expectedProviderId: FIXTURE_PROVIDER,
          expectedRedirectUri: FIXTURE_REDIRECT_URI,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.notFound });
    });

    it("rejects missing state with the invalid-input code", async () => {
      const store = new InProcessLmsOAuthStateStore();
      await expect(
        store.consume({
          state: "",
          expectedProviderId: FIXTURE_PROVIDER,
          expectedRedirectUri: FIXTURE_REDIRECT_URI,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.invalidInput });
    });

    it("rejects a provider mismatch", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: "canvasFake" as LmsProviderId,
          expectedRedirectUri: FIXTURE_REDIRECT_URI,
        }),
      ).rejects.toMatchObject({
        code: LMS_OAUTH_STATE_ERROR_CODES.providerMismatch,
      });
    });

    it("rejects a redirect mismatch", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: FIXTURE_PROVIDER,
          expectedRedirectUri: "https://fixture.example.invalid/other-callback",
        }),
      ).rejects.toMatchObject({
        code: LMS_OAUTH_STATE_ERROR_CODES.redirectMismatch,
      });
    });

    it("is single-use: replaying a valid consume rejects with the consumed code", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      await store.consume({
        state,
        expectedProviderId: FIXTURE_PROVIDER,
        expectedRedirectUri: FIXTURE_REDIRECT_URI,
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: FIXTURE_PROVIDER,
          expectedRedirectUri: FIXTURE_REDIRECT_URI,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.consumed });
    });

    it("rejects an expired record", async () => {
      const originalNow = Date.now;
      const store = new InProcessLmsOAuthStateStore();
      try {
        const t0 = 1_000_000_000_000;
        Date.now = () => t0;
        const { state } = await store.issue({
          teacherId: FIXTURE_TEACHER_ID,
          providerId: FIXTURE_PROVIDER,
          redirectUri: FIXTURE_REDIRECT_URI,
        });
        // Advance past the expiration window.
        Date.now = () => t0 + LMS_OAUTH_STATE_TTL_MS_FOR_TESTS + 1;
        await expect(
          store.consume({
            state,
            expectedProviderId: FIXTURE_PROVIDER,
            expectedRedirectUri: FIXTURE_REDIRECT_URI,
          }),
        ).rejects.toMatchObject({
          code: LMS_OAUTH_STATE_ERROR_CODES.expired,
        });
      } finally {
        Date.now = originalNow;
      }
    });

    it("rejects with intentMismatch when expectedIntent differs from stored intent", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
        intent: "initialConnect",
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: FIXTURE_PROVIDER,
          expectedRedirectUri: FIXTURE_REDIRECT_URI,
          expectedIntent: "publication",
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.intentMismatch });
    });

    it("succeeds when expectedIntent matches the stored intent", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
        intent: "publication",
      });
      const result = await store.consume({
        state,
        expectedProviderId: FIXTURE_PROVIDER,
        expectedRedirectUri: FIXTURE_REDIRECT_URI,
        expectedIntent: "publication",
      });
      expect(result.teacherId).toBe(FIXTURE_TEACHER_ID);
    });

    it("succeeds when expectedIntent is absent regardless of stored intent", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
        intent: "publication",
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: FIXTURE_PROVIDER,
          expectedRedirectUri: FIXTURE_REDIRECT_URI,
        }),
      ).resolves.toMatchObject({ teacherId: FIXTURE_TEACHER_ID });
    });

    it("guarantees exactly one successful concurrent consume for the same state", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const attempts = Array.from({ length: 8 }, () =>
        store
          .consume({
            state,
            expectedProviderId: FIXTURE_PROVIDER,
            expectedRedirectUri: FIXTURE_REDIRECT_URI,
          })
          .then(
            (result) => ({ ok: true as const, result }),
            (err) => ({ ok: false as const, err }),
          ),
      );
      const results = await Promise.all(attempts);
      const successes = results.filter((r) => r.ok);
      const failures = results.filter((r) => !r.ok);
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(7);
      for (const failure of failures) {
        if (failure.ok) throw new Error("unreachable");
        expect((failure.err as PlatformError).code).toBe(
          LMS_OAUTH_STATE_ERROR_CODES.consumed,
        );
      }
    });
  });

  describe("revokeForTeacher", () => {
    it("removes only records for the specified teacher (and provider) and returns the count", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const a = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const b = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const foreign = await store.issue({
        teacherId: FIXTURE_OTHER_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const removed = await store.revokeForTeacher({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
      });
      expect(removed).toBe(2);
      expect(await store.peek(a.state)).toBeNull();
      expect(await store.peek(b.state)).toBeNull();
      // Foreign teacher record untouched.
      const stillThere = await store.peek(foreign.state);
      expect(stillThere?.teacherId).toBe(FIXTURE_OTHER_TEACHER_ID);
    });

    it("does not remove already-consumed records", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const { state } = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      await store.consume({
        state,
        expectedProviderId: FIXTURE_PROVIDER,
        expectedRedirectUri: FIXTURE_REDIRECT_URI,
      });
      const removed = await store.revokeForTeacher({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
      });
      expect(removed).toBe(0);
      // Peek still reports the consumed record so replay attempts see
      // "consumed" rather than "not found".
      expect(await store.peek(state)).toMatchObject({ consumed: true });
    });

    it("ignores records for other providers when a providerId is supplied", async () => {
      const store = new InProcessLmsOAuthStateStore();
      const a = await store.issue({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: FIXTURE_PROVIDER,
        redirectUri: FIXTURE_REDIRECT_URI,
      });
      const removed = await store.revokeForTeacher({
        teacherId: FIXTURE_TEACHER_ID,
        providerId: "canvasFake" as LmsProviderId,
      });
      expect(removed).toBe(0);
      expect(await store.peek(a.state)).not.toBeNull();
    });
  });
});

describe("state store test seams", () => {
  afterEach(() => {
    resetLmsOAuthStateStoreForTests();
  });

  it("getLmsOAuthStateStore returns the default in-process binding", () => {
    expect(getLmsOAuthStateStore()).toBeInstanceOf(InProcessLmsOAuthStateStore);
  });

  it("setLmsOAuthStateStore replaces the binding and resetLmsOAuthStateStoreForTests restores it", () => {
    const injected = new InProcessLmsOAuthStateStore();
    setLmsOAuthStateStore(injected);
    expect(getLmsOAuthStateStore()).toBe(injected);
    resetLmsOAuthStateStoreForTests();
    expect(getLmsOAuthStateStore()).not.toBe(injected);
    expect(getLmsOAuthStateStore()).toBeInstanceOf(InProcessLmsOAuthStateStore);
  });

  it("withLmsOAuthStateStore restores the prior binding even when the block throws", async () => {
    const outer = new InProcessLmsOAuthStateStore();
    setLmsOAuthStateStore(outer);
    const inner = new InProcessLmsOAuthStateStore();
    await expect(
      withLmsOAuthStateStore(inner, () => {
        expect(getLmsOAuthStateStore()).toBe(inner);
        return Promise.reject(new Error("intentional test failure"));
      }),
    ).rejects.toThrow("intentional test failure");
    expect(getLmsOAuthStateStore()).toBe(outer);
  });
});
