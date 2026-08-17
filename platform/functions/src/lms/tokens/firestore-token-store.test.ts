/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Sprint 23D. FirestoreLmsTokenStore coverage. Every fixture is
// fictional. No real teacher, provider account, or credential
// appears.

import type { LmsProviderId } from "../../shared";

import { FakeFirestore } from "../shared/firestore-fake-for-tests";

import { FirestoreLmsTokenStore } from "./firestore-token-store";
import type { LmsTokenBundle } from "./token-store";

const TEACHER = "fixture-teacher-alpha";
const PROVIDER: LmsProviderId = "googleClassroom";

function makeStore(): {
  store: FirestoreLmsTokenStore;
  db: FakeFirestore;
} {
  const db = new FakeFirestore();
  return { store: new FirestoreLmsTokenStore(db as any), db };
}

function fixtureBundle(overrides: Partial<LmsTokenBundle> = {}): LmsTokenBundle {
  return {
    providerId: PROVIDER,
    teacherId: TEACHER,
    accessToken: "fixture-access-token",
    refreshToken: "fixture-refresh-token",
    scopes: ["scope.a", "scope.b"],
    expiresAtEpochMs: Date.now() + 60 * 60 * 1000,
    upstreamAccountIdentifier: "fixture-upstream-id",
    ...overrides,
  };
}

describe("FirestoreLmsTokenStore", () => {
  describe("store", () => {
    it("returns an opaque lms_token_<hex> reference", async () => {
      const { store } = makeStore();
      const ref = await store.store(fixtureBundle());
      expect(ref).toMatch(/^lms_token_[0-9a-f]{32}$/);
    });

    it("persists the bundle so resolve returns it byte-for-byte", async () => {
      const { store } = makeStore();
      const bundle = fixtureBundle();
      const ref = await store.store(bundle);
      const resolved = await store.resolve(ref);
      expect(resolved).toEqual(bundle);
    });

    it("omits the refreshToken field when absent on the input", async () => {
      const { store } = makeStore();
      const ref = await store.store(
        fixtureBundle({ refreshToken: undefined }),
      );
      const resolved = await store.resolve(ref);
      expect(resolved.refreshToken).toBeUndefined();
    });

    it("omits expiresAtEpochMs when absent on the input", async () => {
      const { store } = makeStore();
      const ref = await store.store(
        fixtureBundle({ expiresAtEpochMs: undefined }),
      );
      const resolved = await store.resolve(ref);
      expect(resolved.expiresAtEpochMs).toBeUndefined();
    });

    it("issues distinct references for distinct calls", async () => {
      const { store } = makeStore();
      const refA = await store.store(fixtureBundle());
      const refB = await store.store(fixtureBundle());
      expect(refA).not.toBe(refB);
    });
  });

  describe("resolve", () => {
    it("rejects an unknown reference with lms.tokenNotFound", async () => {
      const { store } = makeStore();
      await expect(store.resolve("lms_token_missing")).rejects.toMatchObject({
        code: "lms.tokenNotFound",
      });
    });

    it("rejects an empty reference with lms.tokenNotFound", async () => {
      const { store } = makeStore();
      await expect(store.resolve("")).rejects.toMatchObject({
        code: "lms.tokenNotFound",
      });
    });

    it("rejects a corrupted document with lms.tokenCorrupted", async () => {
      const { store, db } = makeStore();
      const ref = "lms_token_corrupted";
      // Seed the collection directly with a malformed row.
      await (db as any).collection("lmsTokenBundles").doc(ref).create({
        providerId: PROVIDER,
        teacherId: TEACHER,
        // accessToken intentionally missing
        scopes: ["scope.a"],
        upstreamAccountIdentifier: "id",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(store.resolve(ref)).rejects.toMatchObject({
        code: "lms.tokenCorrupted",
      });
    });
  });

  describe("persistRefreshedCredential (PDR-030h)", () => {
    const OLD_EXPIRY = 1_000_000_000_000;
    const NEW_EXPIRY = OLD_EXPIRY + 60 * 60 * 1000;

    it("updates the access token and expiry in place under the same tokenRef", async () => {
      const { store } = makeStore();
      const ref = await store.store(
        fixtureBundle({ accessToken: "old-access", expiresAtEpochMs: OLD_EXPIRY }),
      );
      const merged = await store.persistRefreshedCredential({
        tokenRef: ref,
        observedExpiresAtEpochMs: OLD_EXPIRY,
        refreshed: { accessToken: "new-access", expiresAtEpochMs: NEW_EXPIRY },
      });
      expect(merged.accessToken).toBe("new-access");
      expect(merged.expiresAtEpochMs).toBe(NEW_EXPIRY);
      // tokenRef is stable: resolving the SAME reference returns the update.
      const resolved = await store.resolve(ref);
      expect(resolved.accessToken).toBe("new-access");
      expect(resolved.expiresAtEpochMs).toBe(NEW_EXPIRY);
    });

    it("preserves the existing refresh token when the refresh omits one", async () => {
      const { store } = makeStore();
      const ref = await store.store(
        fixtureBundle({
          refreshToken: "keep-this-refresh-token",
          expiresAtEpochMs: OLD_EXPIRY,
        }),
      );
      const merged = await store.persistRefreshedCredential({
        tokenRef: ref,
        observedExpiresAtEpochMs: OLD_EXPIRY,
        refreshed: { accessToken: "new-access", expiresAtEpochMs: NEW_EXPIRY },
      });
      expect(merged.refreshToken).toBe("keep-this-refresh-token");
      const resolved = await store.resolve(ref);
      expect(resolved.refreshToken).toBe("keep-this-refresh-token");
    });

    it("preserves the existing scopes when the refresh omits them", async () => {
      const { store } = makeStore();
      const scopes = ["scope.a", "scope.b", "scope.c", "scope.d"];
      const ref = await store.store(
        fixtureBundle({ scopes, expiresAtEpochMs: OLD_EXPIRY }),
      );
      const merged = await store.persistRefreshedCredential({
        tokenRef: ref,
        observedExpiresAtEpochMs: OLD_EXPIRY,
        refreshed: { accessToken: "new-access", expiresAtEpochMs: NEW_EXPIRY },
      });
      expect(merged.scopes).toEqual(scopes);
    });

    it("does not change providerId, teacherId, or upstream identity", async () => {
      const { store } = makeStore();
      const ref = await store.store(fixtureBundle({ expiresAtEpochMs: OLD_EXPIRY }));
      const merged = await store.persistRefreshedCredential({
        tokenRef: ref,
        observedExpiresAtEpochMs: OLD_EXPIRY,
        refreshed: { accessToken: "new-access", expiresAtEpochMs: NEW_EXPIRY },
      });
      expect(merged.providerId).toBe(PROVIDER);
      expect(merged.teacherId).toBe(TEACHER);
      expect(merged.upstreamAccountIdentifier).toBe("fixture-upstream-id");
    });

    it("adopts the stored bundle without overwriting when a concurrent refresh already advanced expiry (CAS)", async () => {
      const { store } = makeStore();
      // Seed a bundle whose stored expiry is ALREADY newer than the caller's
      // observed value, as if another worker refreshed first.
      const ref = await store.store(
        fixtureBundle({ accessToken: "winner-access", expiresAtEpochMs: NEW_EXPIRY }),
      );
      const merged = await store.persistRefreshedCredential({
        tokenRef: ref,
        observedExpiresAtEpochMs: OLD_EXPIRY,
        refreshed: {
          accessToken: "loser-access",
          expiresAtEpochMs: OLD_EXPIRY + 1000,
        },
      });
      // The older result is discarded; the newer stored bundle is returned.
      expect(merged.accessToken).toBe("winner-access");
      expect(merged.expiresAtEpochMs).toBe(NEW_EXPIRY);
      const resolved = await store.resolve(ref);
      expect(resolved.accessToken).toBe("winner-access");
    });

    it("rejects with lms.tokenNotFound when the bundle was revoked concurrently", async () => {
      const { store } = makeStore();
      await expect(
        store.persistRefreshedCredential({
          tokenRef: "lms_token_gone",
          observedExpiresAtEpochMs: OLD_EXPIRY,
          refreshed: { accessToken: "x", expiresAtEpochMs: NEW_EXPIRY },
        }),
      ).rejects.toMatchObject({ code: "lms.tokenNotFound" });
    });

    it("converges two concurrent refreshers to a single newer-expiry write", async () => {
      const { store, db } = makeStore();
      const ref = await store.store(
        fixtureBundle({
          accessToken: "stale-access",
          refreshToken: "shared-refresh-token",
          expiresAtEpochMs: OLD_EXPIRY,
        }),
      );

      // Interleave: while the first refresh transaction is paused after
      // computing its write, a second refresh commits a LATER expiry. The
      // first transaction then observes the version bump, retries, and its
      // compare-and-swap adopts the newer bundle instead of overwriting it.
      let fired = false;
      (db as any).transactionHook = async () => {
        if (fired) return;
        fired = true;
        await store.persistRefreshedCredential({
          tokenRef: ref,
          observedExpiresAtEpochMs: OLD_EXPIRY,
          refreshed: {
            accessToken: "second-access",
            expiresAtEpochMs: OLD_EXPIRY + 2 * 60 * 60 * 1000,
          },
        });
      };

      const firstResult = await store.persistRefreshedCredential({
        tokenRef: ref,
        observedExpiresAtEpochMs: OLD_EXPIRY,
        refreshed: {
          accessToken: "first-access",
          expiresAtEpochMs: OLD_EXPIRY + 1 * 60 * 60 * 1000,
        },
      });

      // The later-expiry (second) refresh wins for both callers and for the
      // durable store; the refresh token is never lost.
      expect(firstResult.accessToken).toBe("second-access");
      const resolved = await store.resolve(ref);
      expect(resolved.accessToken).toBe("second-access");
      expect(resolved.expiresAtEpochMs).toBe(OLD_EXPIRY + 2 * 60 * 60 * 1000);
      expect(resolved.refreshToken).toBe("shared-refresh-token");
    });
  });

  describe("revoke", () => {
    it("removes the stored bundle so subsequent resolve fails", async () => {
      const { store } = makeStore();
      const ref = await store.store(fixtureBundle());
      await store.revoke(ref);
      await expect(store.resolve(ref)).rejects.toMatchObject({
        code: "lms.tokenNotFound",
      });
    });

    it("is idempotent - revoking twice does not throw", async () => {
      const { store } = makeStore();
      const ref = await store.store(fixtureBundle());
      await store.revoke(ref);
      await expect(store.revoke(ref)).resolves.toBeUndefined();
    });

    it("is a no-op for an unknown reference", async () => {
      const { store } = makeStore();
      await expect(store.revoke("lms_token_never")).resolves.toBeUndefined();
    });

    it("no-ops for an empty reference", async () => {
      const { store } = makeStore();
      await expect(store.revoke("")).resolves.toBeUndefined();
    });
  });
});
