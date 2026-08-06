import {
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { PlatformError, type LmsProviderId } from "../../shared";
import { getAdminFirestore } from "../../shared/firestore/admin";

import {
  LMS_OAUTH_STATE_ERROR_CODES,
  type LmsOAuthStateBinding,
  type LmsOAuthStateConsumeInput,
  type LmsOAuthStateConsumeResult,
  type LmsOAuthStateIntent,
  type LmsOAuthStateIssueInput,
  type LmsOAuthStateIssueResult,
  type LmsOAuthStateRevokeForTeacherInput,
  type LmsOAuthStateStore,
} from "./state-store";

// Sprint 23D. Durable, multi-instance-safe OAuth state and PKCE
// custody store backed by Firestore.
//
// -------------------- Design --------------------
//
// * One collection: `lmsOAuthStates/{state}`. Document identifier is
//   the opaque 256-bit state value (64 hex characters). The identifier
//   is high-entropy and lookup-only; the caller never enumerates.
//
// * Fields:
//     - teacherId: LyfeLabz Firebase Auth UID that initiated the flow.
//     - providerId: closed LmsProviderId vocabulary.
//     - redirectUri: bound to the state at issue time.
//     - codeVerifier: RFC 7636 PKCE verifier (server-side custody).
//     - codeChallenge: derived S256 challenge for parity with the
//       upstream authorization request.
//     - issuedAt / expiresAt: Firestore Timestamps for observability.
//     - consumedAt: Timestamp when the state was atomically consumed,
//       or null while pending.
//
// * The verifier field NEVER leaves this module except through the
//   `consume` return value handed to the completion callable's token
//   exchange. `peek` structurally excludes it.
//
// * Concurrency: `consume` executes inside a Firestore transaction.
//   The read/update pair is retried on write conflict by the admin
//   SDK, guaranteeing that at most one concurrent caller observes
//   `consumedAt == null` and therefore that at most one caller
//   receives the verifier for a given state value. Any losing
//   concurrent caller observes the already-set `consumedAt` on
//   retry and is rejected with `lms.oauthStateAlreadyConsumed`.
//
// * TTL: `expiresAt` is a Firestore Timestamp. Callers reject on
//   expiration regardless of storage age. The store also exposes
//   `sweepExpiredForTests` so integration tests can proactively drop
//   expired rows; production installs a Firestore TTL policy on
//   `expiresAt` per the LMS operations runbook (documented in
//   SPRINT_23D_COMPLETION_REPORT.md).
//
// * Security: rules deny every client operation on the collection
//   (see platform/firebase/firestore.rules `lmsOAuthStates` block).
//   Nothing on the record is safe to expose to a client; the store
//   never renders a record to a client-facing shape.

export const LMS_OAUTH_STATES_COLLECTION = "lmsOAuthStates";

// Opaque state length in bytes (256 bits of entropy).
const OAUTH_STATE_BYTES = 32;

// PKCE code_verifier length in bytes.
const OAUTH_VERIFIER_BYTES = 32;

// Ten-minute expiration window, matching the in-process default.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type StoredStateFields = {
  teacherId: string;
  providerId: LmsProviderId;
  redirectUri: string;
  intent: LmsOAuthStateIntent;
  codeVerifier: string;
  codeChallenge: string;
  issuedAt: Timestamp;
  expiresAt: Timestamp;
  consumedAt: Timestamp | null;
};

function base64UrlNoPadding(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function derivePkceS256Challenge(codeVerifier: string): string {
  const digest = createHash("sha256").update(codeVerifier).digest();
  return base64UrlNoPadding(digest);
}

function assertNonEmptyString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PlatformError(
      LMS_OAUTH_STATE_ERROR_CODES.invalidInput,
      `${fieldName} must be a non-empty string.`,
    );
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export class FirestoreLmsOAuthStateStore implements LmsOAuthStateStore {
  // The store accepts an explicit Firestore instance for tests; in
  // production it resolves the admin default lazily.
  private readonly firestore: () => Firestore;

  constructor(firestore?: Firestore) {
    this.firestore = firestore ? () => firestore : () => getAdminFirestore();
  }

  private collection(): CollectionReference<StoredStateFields> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return this.firestore().collection(
      LMS_OAUTH_STATES_COLLECTION,
    ) as CollectionReference<StoredStateFields>;
  }

  private docRef(state: string): DocumentReference<StoredStateFields> {
    return this.collection().doc(state);
  }

  async issue(
    input: LmsOAuthStateIssueInput,
  ): Promise<LmsOAuthStateIssueResult> {
    assertNonEmptyString(input.teacherId, "teacherId");
    assertNonEmptyString(input.providerId, "providerId");
    assertNonEmptyString(input.redirectUri, "redirectUri");

    // Loop guards against the astronomically unlikely case of a state
    // collision. Two 256-bit values coinciding within a live TTL window
    // is a cryptographic impossibility, but a `.create()` refusal is
    // still the correct response.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = randomBytes(OAUTH_STATE_BYTES).toString("hex");
      const codeVerifier = base64UrlNoPadding(randomBytes(OAUTH_VERIFIER_BYTES));
      const codeChallenge = derivePkceS256Challenge(codeVerifier);
      const now = Date.now();
      const record: StoredStateFields = {
        teacherId: input.teacherId,
        providerId: input.providerId,
        redirectUri: input.redirectUri,
        intent: input.intent ?? "initialConnect",
        codeVerifier,
        codeChallenge,
        issuedAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + OAUTH_STATE_TTL_MS),
        consumedAt: null,
      };
      try {
        await this.docRef(state).create(record);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        // Firestore returns 6 ALREADY_EXISTS on `.create()` collision.
        if (code === 6 || code === "already-exists") continue;
        throw err;
      }
      return { state, codeChallenge };
    }
    throw new PlatformError(
      "lms.oauthStateCollision",
      "Failed to allocate a unique OAuth state value.",
    );
  }

  async peek(state: string): Promise<LmsOAuthStateBinding | null> {
    if (typeof state !== "string" || state.length === 0) return null;
    const snap = await this.docRef(state).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data) return null;
    return {
      teacherId: data.teacherId,
      providerId: data.providerId,
      redirectUri: data.redirectUri,
      intent: data.intent,
      issuedAtEpochMs: data.issuedAt.toMillis(),
      expiresAtEpochMs: data.expiresAt.toMillis(),
      consumed: data.consumedAt !== null,
    };
  }

  async consume(
    input: LmsOAuthStateConsumeInput,
  ): Promise<LmsOAuthStateConsumeResult> {
    assertNonEmptyString(input.state, "state");
    assertNonEmptyString(input.expectedProviderId, "expectedProviderId");
    assertNonEmptyString(input.expectedRedirectUri, "expectedRedirectUri");

    const docRef = this.docRef(input.state);

    // Step 1: atomic claim. Firestore rolls back pending writes on
    // throw, so the "consumed" marker MUST be committed BEFORE any
    // validation that could throw. This transaction reads the record,
    // refuses if already consumed, and commits the consumed marker
    // by returning normally. Two concurrent claims are serialized by
    // the admin SDK's read/write conflict retry: the losing caller
    // observes the marker on retry and refuses with
    // `lms.oauthStateAlreadyConsumed`.
    const claimed: StoredStateFields = await this.firestore().runTransaction(
      async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) {
          throw new PlatformError(
            LMS_OAUTH_STATE_ERROR_CODES.notFound,
            "OAuth state record was not found.",
          );
        }
        const data = snap.data();
        if (!data) {
          throw new PlatformError(
            LMS_OAUTH_STATE_ERROR_CODES.notFound,
            "OAuth state record was empty.",
          );
        }
        if (data.consumedAt !== null) {
          throw new PlatformError(
            LMS_OAUTH_STATE_ERROR_CODES.consumed,
            "OAuth state record was already consumed.",
          );
        }
        tx.update(docRef, { consumedAt: FieldValue.serverTimestamp() });
        return data;
      },
    );

    // Step 2: validate outside the transaction. The record is
    // durably marked consumed regardless of the outcome, so a
    // validation-failed record cannot be replayed.
    if (Date.now() >= claimed.expiresAt.toMillis()) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.expired,
        "OAuth state record has expired.",
      );
    }
    if (!timingSafeStringEqual(claimed.providerId, input.expectedProviderId)) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.providerMismatch,
        "OAuth state record provider does not match the expected provider.",
      );
    }
    if (!timingSafeStringEqual(claimed.redirectUri, input.expectedRedirectUri)) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.redirectMismatch,
        "OAuth state record redirect URI does not match the expected redirect URI.",
      );
    }
    if (
      input.expectedIntent !== undefined &&
      claimed.intent !== input.expectedIntent
    ) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.intentMismatch,
        "OAuth state record intent does not match the expected intent.",
      );
    }
    return {
      codeVerifier: claimed.codeVerifier,
      teacherId: claimed.teacherId,
    };
  }

  async revokeForTeacher(
    input: LmsOAuthStateRevokeForTeacherInput,
  ): Promise<number> {
    assertNonEmptyString(input.teacherId, "teacherId");
    let query = this.collection()
      .where("teacherId", "==", input.teacherId)
      .where("consumedAt", "==", null);
    if (input.providerId !== undefined) {
      query = query.where("providerId", "==", input.providerId);
    }
    const snap = await query.get();
    if (snap.empty) return 0;
    const batch = this.firestore().batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    return snap.size;
  }
}

export const LMS_OAUTH_STATE_TTL_MS_FOR_FIRESTORE = OAUTH_STATE_TTL_MS;
