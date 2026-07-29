import {
  FieldValue,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type Timestamp,
} from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";

import { PlatformError, type LmsProviderId } from "../../shared";
import { getAdminFirestore } from "../../shared/firestore/admin";

import type { LmsTokenBundle, LmsTokenStore } from "./token-store";

// Sprint 23D. Durable, multi-instance-safe OAuth token bundle store
// backed by Firestore.
//
// -------------------- Design --------------------
//
// * One collection: `lmsTokenBundles/{tokenRef}`. Document identifier
//   is the opaque `lms_token_${hex}` reference recorded in the
//   client-readable `lmsConnections/{connectionId}.tokenRef` field.
//   The identifier is deliberately not derivable from the connection
//   id so a Firestore rules bug on the connection surface does not
//   let a client enumerate token documents by guessing their path.
//
// * Fields: providerId, teacherId, accessToken, refreshToken?, scopes,
//   expiresAtEpochMs?, upstreamAccountIdentifier, createdAt, updatedAt.
//   Timestamps are Firestore Timestamps for observability; the epoch
//   millis on `expiresAtEpochMs` is preserved for parity with the
//   existing LmsTokenBundle contract (adapters compute expiry from
//   epoch millis).
//
// * Security: rules deny every client operation on the collection
//   (see platform/firebase/firestore.rules `lmsTokenBundles` block).
//   Nothing on the record is safe to expose to a client. The store
//   never logs the accessToken or refreshToken, and no code path
//   returns the raw bundle to a client callable response.
//
// * Concurrency: `store` writes a fresh document via `.create()` to
//   guarantee non-overwrite. `revoke` deletes idempotently. A future
//   refresh path can use a Firestore transaction over the same
//   document to swap the token material atomically; the current
//   sprint does not add a refresh caller and does not add refresh
//   surface area beyond the LmsTokenStore contract (see
//   SPRINT_23D_COMPLETION_REPORT.md "Refresh convergence").

export const LMS_TOKEN_BUNDLES_COLLECTION = "lmsTokenBundles";

type StoredTokenFields = {
  providerId: LmsProviderId;
  teacherId: string;
  accessToken: string;
  refreshToken?: string;
  scopes: readonly string[];
  expiresAtEpochMs?: number;
  upstreamAccountIdentifier: string;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
};

export class FirestoreLmsTokenStore implements LmsTokenStore {
  private readonly firestore: () => Firestore;

  constructor(firestore?: Firestore) {
    this.firestore = firestore ? () => firestore : () => getAdminFirestore();
  }

  private collection(): CollectionReference<StoredTokenFields> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return this.firestore().collection(
      LMS_TOKEN_BUNDLES_COLLECTION,
    ) as CollectionReference<StoredTokenFields>;
  }

  private docRef(tokenRef: string): DocumentReference<StoredTokenFields> {
    return this.collection().doc(tokenRef);
  }

  async store(bundle: LmsTokenBundle): Promise<string> {
    // The reference is high-entropy (128 bits) and prefixed for
    // human-recognition in log correlation. `.create()` guarantees
    // non-overwrite; a collision loops to a fresh reference.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ref = `lms_token_${randomBytes(16).toString("hex")}`;
      const payload: StoredTokenFields = {
        providerId: bundle.providerId,
        teacherId: bundle.teacherId,
        accessToken: bundle.accessToken,
        ...(bundle.refreshToken !== undefined
          ? { refreshToken: bundle.refreshToken }
          : {}),
        scopes: bundle.scopes,
        ...(bundle.expiresAtEpochMs !== undefined
          ? { expiresAtEpochMs: bundle.expiresAtEpochMs }
          : {}),
        upstreamAccountIdentifier: bundle.upstreamAccountIdentifier,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      try {
        await this.docRef(ref).create(payload);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code === 6 || code === "already-exists") continue;
        throw err;
      }
      return ref;
    }
    throw new PlatformError(
      "lms.tokenReferenceCollision",
      "Failed to allocate a unique token reference.",
    );
  }

  async resolve(tokenRef: string): Promise<LmsTokenBundle> {
    if (typeof tokenRef !== "string" || tokenRef.length === 0) {
      throw new PlatformError(
        "lms.tokenNotFound",
        "No LMS token bundle is registered for this reference.",
      );
    }
    const snap = await this.docRef(tokenRef).get();
    if (!snap.exists) {
      throw new PlatformError(
        "lms.tokenNotFound",
        "No LMS token bundle is registered for this reference.",
      );
    }
    const data = snap.data();
    if (!data) {
      throw new PlatformError(
        "lms.tokenCorrupted",
        "LMS token bundle document is present but has no data.",
      );
    }
    if (
      typeof data.accessToken !== "string" ||
      typeof data.teacherId !== "string" ||
      typeof data.providerId !== "string" ||
      typeof data.upstreamAccountIdentifier !== "string" ||
      !Array.isArray(data.scopes)
    ) {
      throw new PlatformError(
        "lms.tokenCorrupted",
        "LMS token bundle document is missing required fields.",
      );
    }
    return {
      providerId: data.providerId,
      teacherId: data.teacherId,
      accessToken: data.accessToken,
      ...(data.refreshToken !== undefined
        ? { refreshToken: data.refreshToken }
        : {}),
      scopes: data.scopes as readonly string[],
      ...(data.expiresAtEpochMs !== undefined
        ? { expiresAtEpochMs: data.expiresAtEpochMs }
        : {}),
      upstreamAccountIdentifier: data.upstreamAccountIdentifier,
    };
  }

  async revoke(tokenRef: string): Promise<void> {
    if (typeof tokenRef !== "string" || tokenRef.length === 0) return;
    // `.delete()` is idempotent; a missing document is not an error.
    await this.docRef(tokenRef).delete();
  }
}
