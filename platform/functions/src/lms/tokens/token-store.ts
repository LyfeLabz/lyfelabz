import { randomBytes } from "node:crypto";

import { PlatformError, type LmsProviderId } from "../../shared";

// Server-only OAuth token storage abstraction per PDR-019e and
// LMS_INTEGRATION_ARCHITECTURE.md §10.3.3. The store is the single
// canonical path by which a Cloud Function trades a `tokenRef` (the
// opaque field held in the client-readable `lmsConnections` document)
// for the live access and refresh tokens required by a provider adapter.
//
// The tokens themselves are never written to a Firestore document and
// never sent to a client per §5.3 and §5.5 of the architecture. The
// operational implementation is a secret-manager-backed store; the
// scaffolding here provides the interface, a stable in-process fallback
// used by the Emulator Suite and by unit tests, and the invariant that
// every caller flows through the same shape.

export type LmsTokenBundle = {
  readonly providerId: LmsProviderId;
  readonly teacherId: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly scopes: readonly string[];
  readonly expiresAtEpochMs?: number;
  readonly upstreamAccountIdentifier: string;
};

export type LmsTokenStore = {
  // Persist a freshly-granted token bundle server-side and return an
  // opaque reference. The reference is safe to record in a Firestore
  // document because it exposes nothing about the token material.
  store(bundle: LmsTokenBundle): Promise<string>;

  // Resolve a live token bundle from an opaque reference. Used by every
  // callable that must call the upstream LMS on behalf of a teacher. The
  // resolution never leaves the Cloud Function trust boundary.
  resolve(tokenRef: string): Promise<LmsTokenBundle>;

  // Revoke and discard the stored bundle for a reference. Called by the
  // disconnect callable after the adapter revokes the upstream grant so
  // no residual token material persists in the operational store.
  revoke(tokenRef: string): Promise<void>;
};

// The default, in-process fallback store. Adequate for the Emulator
// Suite and unit tests; not adequate for production. The production
// binding is wired in a later sprint when the secret-manager operational
// prerequisite (LMS_INTEGRATION_ARCHITECTURE.md §10.3.3) is satisfied.
class InProcessLmsTokenStore implements LmsTokenStore {
  private readonly bundles = new Map<string, LmsTokenBundle>();

  store(bundle: LmsTokenBundle): Promise<string> {
    const ref = `lms_token_${randomBytes(16).toString("hex")}`;
    this.bundles.set(ref, bundle);
    return Promise.resolve(ref);
  }

  resolve(tokenRef: string): Promise<LmsTokenBundle> {
    const bundle = this.bundles.get(tokenRef);
    if (!bundle) {
      return Promise.reject(
        new PlatformError(
          "lms.tokenNotFound",
          "No LMS token bundle is registered for this reference.",
        ),
      );
    }
    return Promise.resolve(bundle);
  }

  revoke(tokenRef: string): Promise<void> {
    this.bundles.delete(tokenRef);
    return Promise.resolve();
  }
}

let ACTIVE_STORE: LmsTokenStore = new InProcessLmsTokenStore();

export function getLmsTokenStore(): LmsTokenStore {
  return ACTIVE_STORE;
}

// Test/operational seam. Production bindings replace the default store
// through this hook so no core code ever reaches for a concrete store.
export function setLmsTokenStore(store: LmsTokenStore): void {
  ACTIVE_STORE = store;
}
