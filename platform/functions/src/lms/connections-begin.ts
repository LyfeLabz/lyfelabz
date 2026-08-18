import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  lmsConnectionDocRef,
} from "../shared";

import { getLmsOAuthStateStore } from "./oauth-state/state-store";
import {
  ensureGoogleClassroomProductionBindings,
  googleClassroomProductionSecrets,
} from "./providers/google-classroom/config-firebase";
import { getProviderAdapter, isRegisteredProvider } from "./providers/registry";
import {
  assertAuthenticatedTeacherForLms,
  requireNonEmptyString,
} from "./shared/actor";
import { lmsConnectionIdFor } from "./shared/ids";
import { getLmsTokenStore } from "./tokens/token-store";

// lmsConnectionsBegin
//
// Connection lifecycle callable (begin) per PDR-020c. Starts the OAuth
// grant against the requested provider and returns the authorization URL
// and opaque state token. The callable performs no Firestore write; the
// connection document is created on completion by lmsConnectionsComplete
// per PDR-019e (server-only tokens) and PDR-019g (additive schema
// evolution).
//
// The provider is resolved through the registry per PDR-020f (provider
// neutrality is permanent); no Google-specific concern reaches this
// file.

export type LmsConnectionsBeginRequest = {
  readonly providerId: string;
  readonly redirectUri: string;
  // Provider-neutral capability selector. "publication" triggers
  // incremental consent for the coursework scope set (PDR-030c). When
  // absent, the flow requests the initial (readonly) scope set. Any other
  // value is refused at runtime rather than silently downgraded.
  readonly capability?: "publication";
  // Sprint 26 certification follow-up - explicit reconnect/recovery signal.
  // When true, the teacher has explicitly requested credential recovery for
  // an existing active connection LyfeLabz observed to be unusable (the
  // Settings Reconnect action). It carries the base (initial) scope set,
  // exactly like an initial connect, but binds the "reconnect" OAuth-state
  // intent so completion replaces the unusable credential on the same
  // logical connection instead of taking the idempotent duplicate-connect
  // early return. It is never combined with `capability: "publication"`;
  // reconnect and publication widening are distinct product concepts.
  readonly reconnect?: boolean;
};

export type LmsConnectionsBeginResponse = {
  readonly authorizationUrl: string;
  readonly state: string;
};

// Sprint 26 Phase 2 - Google account continuity.
//
// The durable LMS connection owns the Google identity. When a teacher who
// already holds an active connection begins incremental *publication*
// authorization - or an explicit *reconnect* to recover an unusable
// credential (Sprint 26 certification follow-up) - LyfeLabz should
// proactively prefer the Google identity already associated with that
// durable connection, so Google is encouraged to continue with the
// already-connected account. This helper resolves that identity,
// transiently in memory, from the existing credential bundle through the
// established server-only token-store abstraction, and returns it as the
// provider-neutral account hint. The Google adapter converts a present hint
// into Google's `login_hint` (PDR-019h: the Google concept lives only in
// the Google adapter). The reconnect case benefits identically: steering
// the teacher back to the connected account reduces avoidable
// identity-mismatch rejections, and completion-time identity revalidation
// remains the authoritative boundary in both cases.
//
// Read-only and side-effect-free by construction. `getLmsTokenStore()
// .resolve` is a pure read on both the in-process and Firestore stores (a
// single document `.get()`); it never refreshes, rotates, or mutates
// stored credentials. Only `persistRefreshedCredential` mutates, and it
// is never called here. The identifier is used ONLY to build the
// authorization request; it is never persisted anywhere new, never
// written to the connection document, never placed in the OAuth state
// record, never logged, never audited, and never returned to the client.
//
// Steering-only, best-effort, never load-bearing. `login_hint` is a UX
// hint, not an enforcement boundary. Completion-time identity validation
// (`lms.identityMismatch`) and completion-time bundle resolution
// (`lms.connectionTokenResolutionFailed`) remain the authoritative
// security and health boundaries. Every absence or failure here therefore
// degrades to NO hint rather than blocking authorization or fabricating
// an identity:
//   - No active durable connection (an initial-connect-shaped publication
//     begin): no hint. Nothing to prefer.
//   - Bundle resolution fails, or a corrupted bundle is missing the
//     required `upstreamAccountIdentifier`: no hint. The broken connection
//     is NOT masked as healthy here - the widening path at completion
//     independently re-resolves the bundle and returns
//     `lms.connectionTokenResolutionFailed` for a genuinely broken
//     connection, and identity revalidation still hard-rejects a wrong
//     account. Begin degrades the optional hint rather than pre-emptively
//     failing the flow that could recover the connection.
//   - A valid bundle always carries a non-empty `upstreamAccountIdentifier`
//     (a required field enforced by the token-store contract and its
//     runtime validator), so "a valid bundle with no identity" is not a
//     reachable state; an empty/absent value means corruption and is
//     handled as above.
// The entire derivation is wrapped so a transient read failure can never
// regress the begin callable's core contract of issuing a valid
// authorization URL - which, before Sprint 26, performed no connection or
// token read at all.
async function resolveDurableConnectionAccountHint(
  teacherId: string,
  providerId: string,
): Promise<string | undefined> {
  try {
    const connectionId = lmsConnectionIdFor(teacherId, providerId);
    const snapshot = await lmsConnectionDocRef(connectionId).get();
    const data = snapshot.exists ? snapshot.data() : undefined;
    // Only an active connection owned by this teacher for this provider
    // has an identity worth preferring. This mirrors the `hasActiveConnection`
    // predicate the completion handler uses on the same document.
    const hasActiveConnection =
      data !== undefined &&
      data.teacherId === teacherId &&
      data.providerId === providerId &&
      data.status === "active";
    if (!hasActiveConnection) return undefined;

    let bundle;
    try {
      bundle = await getLmsTokenStore().resolve(data.tokenRef);
    } catch {
      // Broken/unresolvable durable bundle. Do not mask it as healthy and
      // do not block re-authorization: proceed with no hint. Completion
      // owns the authoritative broken-connection semantics.
      return undefined;
    }
    const identifier = bundle.upstreamAccountIdentifier;
    return identifier && identifier.length > 0 ? identifier : undefined;
  } catch {
    // Defense-in-depth: account hinting is a best-effort UX enrichment and
    // must never regress begin's core contract of issuing an authorization
    // URL.
    return undefined;
  }
}

async function handler(
  request: CallableRequest<unknown>,
): Promise<LmsConnectionsBeginResponse> {
  // Sprint 23B: idempotent production binding installer. No-op if a
  // test has already installed a fixture transport / config, so unit
  // tests keep working unchanged.
  ensureGoogleClassroomProductionBindings();
  const actor = assertAuthenticatedTeacherForLms(request);
  if (request.data === null || typeof request.data !== "object") {
    throw new PlatformError(
      "lms.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = request.data as Record<string, unknown>;
  const providerId = requireNonEmptyString(
    payload.providerId,
    "lms.invalidProviderId",
    "providerId must be a non-empty string.",
  );
  const redirectUri = requireNonEmptyString(
    payload.redirectUri,
    "lms.invalidRedirectUri",
    "redirectUri must be a non-empty string.",
  );
  if (!isRegisteredProvider(providerId)) {
    throw new PlatformError(
      "lms.unknownProvider",
      `Provider "${providerId}" is not registered.`,
    );
  }
  // Validate the optional capability selector before deriving intent. The
  // only recognized value is the provider-neutral "publication" selector
  // (PDR-030c). An unrecognized value is a client-contract violation and
  // is refused with a sanitized invalid-argument error rather than
  // silently downgraded to an initial connection, which would mask a
  // publication-scope consent request as a readonly connect. The raw
  // value is never echoed back.
  if (
    payload.capability !== undefined &&
    payload.capability !== "publication"
  ) {
    throw new PlatformError(
      "lms.invalidCapability",
      'capability, when provided, must be "publication".',
    );
  }
  // Validate the optional reconnect selector. When provided it must be a
  // boolean, and it must not be combined with the publication capability:
  // reconnect restores the base connection while publication widens scope,
  // so a single begin cannot mean both. The contradictory combination is a
  // client-contract violation and is refused rather than silently resolved
  // to one intent.
  if (
    payload.reconnect !== undefined &&
    typeof payload.reconnect !== "boolean"
  ) {
    throw new PlatformError(
      "lms.invalidReconnect",
      "reconnect, when provided, must be a boolean.",
    );
  }
  if (payload.reconnect === true && payload.capability === "publication") {
    throw new PlatformError(
      "lms.invalidReconnect",
      "reconnect cannot be combined with the publication capability.",
    );
  }
  // Discard any outstanding OAuth state records this teacher may have
  // issued for the same provider in a prior, incomplete `begin` call.
  // A restarted-connection flow (teacher closes the tab, hits begin
  // again) leaves at most one live pending record instead of accreting
  // one per attempt. Best-effort: an in-process store failure here
  // does not block issuing a fresh record.
  try {
    await getLmsOAuthStateStore().revokeForTeacher({
      teacherId: actor.uid,
      providerId,
    });
  } catch {
    // Intentional: revocation is a hygiene step, not a lifecycle step.
  }

  const intent: "initialConnect" | "publication" | "reconnect" =
    payload.capability === "publication"
      ? "publication"
      : payload.reconnect === true
        ? "reconnect"
        : "initialConnect";

  // Sprint 26 Phase 2 + certification follow-up: proactively prefer the
  // durable connection's Google identity for a publication-intent widening
  // and for an explicit reconnect - both operate on an existing active
  // connection whose identity is worth preferring. Initial connect
  // establishes the identity and has nothing to prefer, so it performs no
  // connection or token lookup and supplies no hint - its authorization
  // behavior is byte-for-byte unchanged from before Sprint 26.
  const accountHint =
    intent === "publication" || intent === "reconnect"
      ? await resolveDurableConnectionAccountHint(actor.uid, providerId)
      : undefined;

  const adapter = getProviderAdapter(providerId);
  const { authorizationUrl, state } = await adapter.beginOAuth({
    teacherId: actor.uid,
    redirectUri,
    intent,
    accountHint,
  });
  return { authorizationUrl, state };
}

export const lmsConnectionsBegin = platformCallable(
  { secrets: [...googleClassroomProductionSecrets] },
  handler,
);
export const __lmsConnectionsBeginHandler = handler;
