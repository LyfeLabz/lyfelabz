/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Sprint 23D. FirestoreLmsOAuthStateStore coverage. Every fixture is
// fictional. No real teacher, provider account, or credential appears.

import type { PlatformError, LmsProviderId } from "../../shared";

import { FakeFirestore } from "../shared/firestore-fake-for-tests";

import { FirestoreLmsOAuthStateStore } from "./firestore-state-store";
import { LMS_OAUTH_STATE_ERROR_CODES } from "./state-store";

const TEACHER = "fixture-teacher-alpha";
const OTHER_TEACHER = "fixture-teacher-beta";
const PROVIDER: LmsProviderId = "googleClassroom";
const REDIRECT = "https://fixture.example.invalid/lms-callback";

function makeStore(): {
  store: FirestoreLmsOAuthStateStore;
  db: FakeFirestore;
} {
  const db = new FakeFirestore();
  return {
    store: new FirestoreLmsOAuthStateStore(db as any),
    db,
  };
}

describe("FirestoreLmsOAuthStateStore", () => {
  describe("issue", () => {
    it("returns a 64-hex state and 43-char base64url challenge", async () => {
      const { store } = makeStore();
      const { state, codeChallenge } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(codeChallenge).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    });

    it("persists a pending record readable by peek", async () => {
      const { store } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      const binding = await store.peek(state);
      expect(binding).not.toBeNull();
      expect(binding?.teacherId).toBe(TEACHER);
      expect(binding?.providerId).toBe(PROVIDER);
      expect(binding?.redirectUri).toBe(REDIRECT);
      expect(binding?.consumed).toBe(false);
      expect(binding?.expiresAtEpochMs).toBeGreaterThan(binding?.issuedAtEpochMs ?? 0);
    });

    it("issued records for different teachers are independent", async () => {
      const { store } = makeStore();
      const a = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      const b = await store.issue({
        teacherId: OTHER_TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      expect(a.state).not.toBe(b.state);
    });

    it("rejects invalid input with lms.invalidOAuthStateInput", async () => {
      const { store } = makeStore();
      await expect(
        store.issue({
          teacherId: "",
          providerId: PROVIDER,
          redirectUri: REDIRECT,
        }),
      ).rejects.toMatchObject({
        code: LMS_OAUTH_STATE_ERROR_CODES.invalidInput,
      });
    });
  });

  describe("peek", () => {
    it("returns null for an unknown state", async () => {
      const { store } = makeStore();
      expect(await store.peek("nope")).toBeNull();
    });

    it("returns null for a non-string state", async () => {
      const { store } = makeStore();
      expect(await store.peek("")).toBeNull();
    });
  });

  describe("consume", () => {
    it("returns the code_verifier bound to the state at issue time", async () => {
      const { store } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      const consumed = await store.consume({
        state,
        expectedProviderId: PROVIDER,
        expectedRedirectUri: REDIRECT,
      });
      expect(consumed.teacherId).toBe(TEACHER);
      expect(consumed.codeVerifier.length).toBeGreaterThan(0);
    });

    it("rejects an unknown state with lms.oauthStateNotFound", async () => {
      const { store } = makeStore();
      await expect(
        store.consume({
          state: "0".repeat(64),
          expectedProviderId: PROVIDER,
          expectedRedirectUri: REDIRECT,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.notFound });
    });

    it("rejects a replayed consume with lms.oauthStateAlreadyConsumed", async () => {
      const { store } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      await store.consume({
        state,
        expectedProviderId: PROVIDER,
        expectedRedirectUri: REDIRECT,
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: PROVIDER,
          expectedRedirectUri: REDIRECT,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.consumed });
    });

    it("rejects a mismatched providerId with lms.oauthStateProviderMismatch", async () => {
      const { store } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: "someOtherProvider" as LmsProviderId,
          expectedRedirectUri: REDIRECT,
        }),
      ).rejects.toMatchObject({
        code: LMS_OAUTH_STATE_ERROR_CODES.providerMismatch,
      });
    });

    it("rejects a mismatched redirectUri with lms.oauthStateRedirectMismatch", async () => {
      const { store } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      await expect(
        store.consume({
          state,
          expectedProviderId: PROVIDER,
          expectedRedirectUri: "https://elsewhere.example.invalid/cb",
        }),
      ).rejects.toMatchObject({
        code: LMS_OAUTH_STATE_ERROR_CODES.redirectMismatch,
      });
    });

    it("rejects an expired state and marks it consumed so it stays unusable", async () => {
      const { store } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      const spy = jest
        .spyOn(Date, "now")
        .mockReturnValue(Date.now() + 60 * 60 * 1000);
      try {
        await expect(
          store.consume({
            state,
            expectedProviderId: PROVIDER,
            expectedRedirectUri: REDIRECT,
          }),
        ).rejects.toMatchObject({
          code: LMS_OAUTH_STATE_ERROR_CODES.expired,
        });
      } finally {
        spy.mockRestore();
      }
      // Peek confirms the record is now marked consumed (defensive).
      const after = await store.peek(state);
      expect(after?.consumed).toBe(true);
    });

    it("second concurrent consume converges on lms.oauthStateAlreadyConsumed under transaction retry", async () => {
      const { store, db } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      // Rig the hook so the FIRST transaction, right after its
      // observation, sees a concurrent second consume advance the
      // row version. The first transaction should retry and one of
      // the two consumes should observe the consumed marker.
      let hookFired = false;
      db.transactionHook = async () => {
        if (hookFired) return;
        hookFired = true;
        // Perform a concurrent consume that lands first.
        await store.consume({
          state,
          expectedProviderId: PROVIDER,
          expectedRedirectUri: REDIRECT,
        });
      };
      await expect(
        store.consume({
          state,
          expectedProviderId: PROVIDER,
          expectedRedirectUri: REDIRECT,
        }),
      ).rejects.toMatchObject({ code: LMS_OAUTH_STATE_ERROR_CODES.consumed });
    });
  });

  describe("revokeForTeacher", () => {
    it("removes only the caller's pending records", async () => {
      const { store } = makeStore();
      await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      await store.issue({
        teacherId: OTHER_TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      const removed = await store.revokeForTeacher({ teacherId: TEACHER });
      expect(removed).toBe(2);
    });

    it("does not remove consumed records", async () => {
      const { store } = makeStore();
      const { state } = await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      await store.consume({
        state,
        expectedProviderId: PROVIDER,
        expectedRedirectUri: REDIRECT,
      });
      const removed = await store.revokeForTeacher({ teacherId: TEACHER });
      expect(removed).toBe(0);
    });

    it("narrows by providerId when supplied", async () => {
      const { store } = makeStore();
      await store.issue({
        teacherId: TEACHER,
        providerId: PROVIDER,
        redirectUri: REDIRECT,
      });
      const removed = await store.revokeForTeacher({
        teacherId: TEACHER,
        providerId: "someOtherProvider" as LmsProviderId,
      });
      expect(removed).toBe(0);
      const alsoRemoved = await store.revokeForTeacher({
        teacherId: TEACHER,
        providerId: PROVIDER,
      });
      expect(alsoRemoved).toBe(1);
    });
  });
});

// Silence unused import warning for the type-only PlatformError re-export.
void (null as unknown as PlatformError);
