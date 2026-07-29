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
