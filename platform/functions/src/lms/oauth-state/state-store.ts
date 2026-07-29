import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { PlatformError, type LmsProviderId } from "../../shared";

// Server-only OAuth state and PKCE custody abstraction. Sprint 23B
// security completion.
//
// The store is the single canonical path by which a Cloud Function:
//
//   1. Issues a cryptographically secure opaque state value at the
//      start of an OAuth authorization flow, binding that state to the
//      authenticated LyfeLabz teacher, the provider, the intended
//      redirect URI, and a freshly-generated PKCE code_verifier /
//      code_challenge pair.
//   2. Consumes that state atomically at completion, returning the
//      stored code_verifier so the callable can supply it to the
//      upstream token-exchange call, and enforcing the single-use
//      lifecycle so a replayed state is rejected.
//
// The code_verifier NEVER leaves the Cloud Function trust boundary and
// is NEVER returned to the client. The store hands the verifier only
// to the adapter path that runs the token exchange.
//
// -------------------- Production suitability --------------------
//
// The default binding is `InProcessLmsOAuthStateStore`. Like
// `InProcessLmsTokenStore`, it is adequate for:
//
//   - unit tests
//   - the Firebase Emulator Suite
//   - controlled single-process validation
//
// It is NOT adequate for a durable multi-instance production deploy.
// A Cloud Function instance restart, a request routed to a different
// warm instance, or any horizontal scaling event will invalidate
// pending OAuth state and will cause a race between concurrent
// instances that cannot see each other's issued records.
//
// Sprint 23B ships this in-process binding paired with the pre-existing
// in-process `LmsTokenStore`. Google Classroom production activation
// remains BLOCKED until durable, multi-instance implementations for
// both stores are implemented and certified alongside operational
// provisioning. This constraint is documented in the Sprint 23B
// completion report and in the LMS operations runbook; adding a
// durable binding is a Sprint 23C obligation.
//
// -------------------- Public API --------------------

// Opaque state length in bytes (256 bits of entropy).
const OAUTH_STATE_BYTES = 32;

// PKCE code_verifier length in bytes. RFC 7636 requires the verifier
// to be a random string of 43-128 characters using the URL-safe
// alphabet. 32 random bytes rendered as base64url gives 43 characters
// with no padding, at the top of the mandated entropy range.
const OAUTH_VERIFIER_BYTES = 32;

// Short, documented expiration window. The teacher normally completes
// the OAuth round trip within seconds; ten minutes is long enough to
// absorb a slow consent screen or a network hiccup without keeping
// unused state records alive.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type LmsOAuthStateIssueInput = {
  readonly teacherId: string;
  readonly providerId: LmsProviderId;
  readonly redirectUri: string;
};

export type LmsOAuthStateIssueResult = {
  // Opaque value the callable returns to the client and includes in
  // the upstream authorization URL as the `state` parameter.
  readonly state: string;
  // PKCE S256 code challenge for inclusion in the upstream
  // authorization URL as the `code_challenge` parameter with
  // `code_challenge_method=S256`. The corresponding verifier stays
  // server-side.
  readonly codeChallenge: string;
};

export type LmsOAuthStateBinding = {
  readonly teacherId: string;
  readonly providerId: LmsProviderId;
  readonly redirectUri: string;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly consumed: boolean;
};

export type LmsOAuthStateConsumeInput = {
  readonly state: string;
  readonly expectedProviderId: LmsProviderId;
  readonly expectedRedirectUri: string;
};

export type LmsOAuthStateConsumeResult = {
  readonly codeVerifier: string;
  readonly teacherId: string;
};

export type LmsOAuthStateRevokeForTeacherInput = {
  readonly teacherId: string;
  readonly providerId?: LmsProviderId;
};

export interface LmsOAuthStateStore {
  // Persist a freshly-issued OAuth state binding. Returns the opaque
  // state value and the PKCE code_challenge; the verifier is retained
  // server-side and never surfaced through this API.
  issue(input: LmsOAuthStateIssueInput): Promise<LmsOAuthStateIssueResult>;

  // Read the (non-secret) binding fields for a state value so the
  // completion callable can enforce the teacher binding before the
  // atomic consume runs. Returns null if the state is unknown. Never
  // returns the verifier.
  peek(state: string): Promise<LmsOAuthStateBinding | null>;

  // Atomically validate and consume the state record, returning the
  // stored code_verifier and the teacher id the record was bound to.
  // The record is marked consumed as part of the same atomic step, so
  // a concurrent second consume for the same state is guaranteed to
  // fail.
  consume(input: LmsOAuthStateConsumeInput): Promise<LmsOAuthStateConsumeResult>;

  // Discard every outstanding (non-consumed and not-yet-expired)
  // state record bound to the given teacher, optionally narrowed to a
  // single provider. Returns the number of records discarded. Used by
  // disconnect and by restarted-connection flows so the ambient list
  // of pending state records does not grow unbounded across a
  // teacher's connection lifetime.
  revokeForTeacher(
    input: LmsOAuthStateRevokeForTeacherInput,
  ): Promise<number>;
}

// -------------------- Error contract --------------------
//
// The store throws specific PlatformError codes so unit tests can
// assert the exact validation failure. The vendor-neutral callable is
// responsible for translating every store failure into the single
// public `lms.invalidOAuthState` code before the error crosses the
// callable boundary. This keeps the store's internal validation
// granularity from leaking to a caller who could use it to enumerate
// server state.

export const LMS_OAUTH_STATE_ERROR_CODES = {
  invalidInput: "lms.invalidOAuthStateInput",
  notFound: "lms.oauthStateNotFound",
  expired: "lms.oauthStateExpired",
  consumed: "lms.oauthStateAlreadyConsumed",
  providerMismatch: "lms.oauthStateProviderMismatch",
  redirectMismatch: "lms.oauthStateRedirectMismatch",
} as const;

function base64UrlNoPadding(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// PKCE S256 derivation per RFC 7636 §4.2: challenge is the
// base64url(SHA256(verifier)), no padding.
export function derivePkceS256Challenge(codeVerifier: string): string {
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

// Constant-time equality for opaque tokens. Prevents an attacker with
// a timing side channel from probing the store for a state prefix.
function timingSafeStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

type StoredRecord = {
  readonly state: string;
  readonly teacherId: string;
  readonly providerId: LmsProviderId;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  consumedAtEpochMs: number | null;
};

// -------------------- Default in-process implementation --------------------

export class InProcessLmsOAuthStateStore implements LmsOAuthStateStore {
  private readonly records = new Map<string, StoredRecord>();

  // eslint-disable-next-line @typescript-eslint/require-await
  async issue(
    input: LmsOAuthStateIssueInput,
  ): Promise<LmsOAuthStateIssueResult> {
    assertNonEmptyString(input.teacherId, "teacherId");
    assertNonEmptyString(input.providerId, "providerId");
    assertNonEmptyString(input.redirectUri, "redirectUri");

    const state = randomBytes(OAUTH_STATE_BYTES).toString("hex");
    const codeVerifier = base64UrlNoPadding(randomBytes(OAUTH_VERIFIER_BYTES));
    const codeChallenge = derivePkceS256Challenge(codeVerifier);
    const now = Date.now();
    const record: StoredRecord = {
      state,
      teacherId: input.teacherId,
      providerId: input.providerId,
      redirectUri: input.redirectUri,
      codeVerifier,
      codeChallenge,
      issuedAtEpochMs: now,
      expiresAtEpochMs: now + OAUTH_STATE_TTL_MS,
      consumedAtEpochMs: null,
    };
    this.records.set(state, record);
    return { state, codeChallenge };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async peek(state: string): Promise<LmsOAuthStateBinding | null> {
    if (typeof state !== "string" || state.length === 0) {
      return null;
    }
    const record = this.records.get(state);
    if (!record) return null;
    return {
      teacherId: record.teacherId,
      providerId: record.providerId,
      redirectUri: record.redirectUri,
      issuedAtEpochMs: record.issuedAtEpochMs,
      expiresAtEpochMs: record.expiresAtEpochMs,
      consumed: record.consumedAtEpochMs !== null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async consume(
    input: LmsOAuthStateConsumeInput,
  ): Promise<LmsOAuthStateConsumeResult> {
    assertNonEmptyString(input.state, "state");
    assertNonEmptyString(input.expectedProviderId, "expectedProviderId");
    assertNonEmptyString(input.expectedRedirectUri, "expectedRedirectUri");

    const record = this.records.get(input.state);
    if (!record) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.notFound,
        "OAuth state record was not found.",
      );
    }
    // Atomic step (single-threaded event loop): observe the consumed
    // marker, then set it before any await. If already set, reject.
    if (record.consumedAtEpochMs !== null) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.consumed,
        "OAuth state record was already consumed.",
      );
    }
    // Claim atomically before any further validation so a losing
    // concurrent caller sees `consumed` on its next attempt. Rolling
    // this back on a validation failure would re-open the record to
    // replay, which is worse than discarding it, so validation
    // failures leave the record consumed and unusable.
    record.consumedAtEpochMs = Date.now();
    this.records.set(input.state, record);

    // Expiration is enforced strictly after the claim so a slow
    // network cannot leave a partially-consumed record readable.
    if (Date.now() >= record.expiresAtEpochMs) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.expired,
        "OAuth state record has expired.",
      );
    }
    if (
      !timingSafeStringEqual(record.providerId, input.expectedProviderId)
    ) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.providerMismatch,
        "OAuth state record provider does not match the expected provider.",
      );
    }
    if (
      !timingSafeStringEqual(record.redirectUri, input.expectedRedirectUri)
    ) {
      throw new PlatformError(
        LMS_OAUTH_STATE_ERROR_CODES.redirectMismatch,
        "OAuth state record redirect URI does not match the expected redirect URI.",
      );
    }
    return {
      codeVerifier: record.codeVerifier,
      teacherId: record.teacherId,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async revokeForTeacher(
    input: LmsOAuthStateRevokeForTeacherInput,
  ): Promise<number> {
    assertNonEmptyString(input.teacherId, "teacherId");
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.teacherId !== input.teacherId) continue;
      if (
        input.providerId !== undefined &&
        record.providerId !== input.providerId
      ) {
        continue;
      }
      if (record.consumedAtEpochMs !== null) continue;
      this.records.delete(key);
      removed += 1;
    }
    return removed;
  }
}

let ACTIVE_STORE: LmsOAuthStateStore = new InProcessLmsOAuthStateStore();

export function getLmsOAuthStateStore(): LmsOAuthStateStore {
  return ACTIVE_STORE;
}

// Test/operational seam. Production bindings replace the default store
// through this hook so no core code ever reaches for a concrete store.
export function setLmsOAuthStateStore(store: LmsOAuthStateStore): void {
  ACTIVE_STORE = store;
}

// Scoped installation helper. Restores the prior binding after `fn`
// resolves or rejects. Tests use this to guarantee cleanup even when
// an assertion throws.
export async function withLmsOAuthStateStore<T>(
  store: LmsOAuthStateStore,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = ACTIVE_STORE;
  ACTIVE_STORE = store;
  try {
    return await fn();
  } finally {
    ACTIVE_STORE = previous;
  }
}

// Test-only reset. Used by afterEach to guarantee state cleanup.
export function resetLmsOAuthStateStoreForTests(): void {
  ACTIVE_STORE = new InProcessLmsOAuthStateStore();
}

// Test-only accessor for the TTL so tests can compute deterministic
// expiration windows without duplicating the constant.
export const LMS_OAUTH_STATE_TTL_MS_FOR_TESTS = OAUTH_STATE_TTL_MS;
