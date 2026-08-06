import type {
  AssignmentLmsPublicationState,
  AssignmentLmsRetrySeam,
} from "../../../assignments/detail/types";
import type {
  IntegrationsCallables,
  IntegrationsDeps,
  IntegrationsPublicationOutcome,
  OAuthHandoff,
} from "../../../settings/integrations/types";

// Sprint 25 Phase 3 shared publication wiring. This module is the single
// client home for the LMS publication attempt model (definition §2,
// blueprint §6-§11, implementation plan §2.1-§2.7). It is consumed by the
// Assign dialog confirm path (curriculum surface) and by the assignment
// detail-view retry entry point. It contains no firebase import, no
// browser storage, and no provider-specific vocabulary; it operates only
// on the provider-neutral callable seams the entry point already wires.
//
// The teacher never sees any of the identifiers used here: attempt
// nonces, provider ids, callable names, OAuth state, or error codes are
// all internal. Every teacher-facing line is minted at the surface layer
// from the calm, provider-neutral `AssignmentLmsPublicationState` this
// module returns.

// A single logical publication action is identified by one attempt nonce
// (implementation plan §2.1). The client mints one nonce per logical
// action - a confirm row action, or an explicit detail-view retry - and
// reuses it for the single automatic re-issue after incremental consent
// so the Phase 1 server-side completed-attempt guard treats the re-issue
// as the same attempt, not a new one.
export function mintNonce(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g && typeof g.randomUUID === "function") {
    return g.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// The one non-terminal outcome: a first publish that resolves with this
// code is a request for the coursework consent scopes, not a failure
// (implementation plan §2.7). No `failed` record and no `lms.publishFailed`
// audit event were written server-side.
export const INSUFFICIENT_SCOPE_CODE = "lms.insufficientScope";

// Connection-not-usable outcomes route the teacher to the existing
// account-level reconnect flow rather than to incremental consent
// (blueprint §11). These are thrown callable errors inspected client-side.
export const RECONNECT_ERROR_CODES: ReadonlySet<string> = new Set([
  "lms.connectionNotActive",
  "lms.connectionNotFound",
]);

// Extract the sanitized platform error code from a thrown callable error.
// A thrown `PlatformError` reaches the client as a Firebase callable error
// whose `details` carries `{ code }` (server `translateThrown`). The raw
// error object, message, and any Firebase internals are never surfaced to
// the teacher; only this stable code is inspected for routing.
export function extractThrownErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const details = (err as { details?: unknown }).details;
    if (details && typeof details === "object") {
      const code = (details as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }
    const direct = (err as { code?: unknown }).code;
    if (typeof direct === "string" && direct.startsWith("lms.")) return direct;
  }
  return undefined;
}

// Provider-neutral consent seam. Only the frozen Phase 2 machinery is
// named: `beginConnection({ capability: "publication" })`, the existing
// browser OAuth handoff, and `completeConnection`. No raw scope string,
// token, or Google account identifier is passed or returned here.
export type PublicationConsentSeam = {
  readonly providerId: string;
  readonly beginConnection: IntegrationsCallables["beginConnection"];
  readonly completeConnection: IntegrationsCallables["completeConnection"];
  readonly openOAuth: OAuthHandoff;
  readonly redirectUri: string;
};

// Consent coordinator. Bounds every incremental-consent handoff for one
// logical scope (one confirm action, or one retry click) to at most one
// OAuth begin and one completion, even when several LMS-linked rows in the
// same confirm each return insufficient scope (definition Part 10, blueprint
// §7). The first row to need consent runs the handoff; concurrent rows
// await the same in-flight result and reuse the one completed consent. A
// declined or failed consent latches `notGranted` for the remainder of the
// action so no second OAuth flow is opened (no consent loop).
export type ConsentCoordinator = {
  readonly ensureConsent: (
    seam: PublicationConsentSeam,
  ) => Promise<"granted" | "notGranted">;
};

async function runConsentHandoff(
  seam: PublicationConsentSeam,
): Promise<"granted" | "notGranted"> {
  try {
    const begun = await seam.beginConnection({
      providerId: seam.providerId,
      redirectUri: seam.redirectUri,
      capability: "publication",
    });
    const handed = await seam.openOAuth({
      authorizationUrl: begun.authorizationUrl,
      redirectUri: seam.redirectUri,
      expectedState: begun.state,
    });
    // The consent outcome discriminator is intentionally not inspected
    // here. Phase 2 may resolve `alreadyAuthorized` even when the teacher
    // declined the coursework scopes (the neutral completion callable can
    // only observe that Google added no new scopes). The re-issue after a
    // completed consent is the authoritative test of whether the scope was
    // actually granted; a still-insufficient re-issue stops without a loop.
    await seam.completeConnection({
      providerId: seam.providerId,
      code: handed.code,
      state: handed.state,
      redirectUri: seam.redirectUri,
    });
    return "granted";
  } catch {
    // Popup blocked, cancelled, denied, state mismatch, or a completion
    // failure. No second automatic OAuth attempt is made; the caller stops
    // and offers manual retry.
    return "notGranted";
  }
}

export function createConsentCoordinator(): ConsentCoordinator {
  let inFlight: Promise<"granted" | "notGranted"> | null = null;
  let settled: "granted" | "notGranted" | null = null;
  return {
    ensureConsent: (seam) => {
      if (settled !== null) return Promise.resolve(settled);
      if (inFlight !== null) return inFlight;
      inFlight = runConsentHandoff(seam).then((result) => {
        settled = result;
        inFlight = null;
        return result;
      });
      return inFlight;
    },
  };
}

// The bounded per-action outcome the surfaces render. Mirrors
// `AssignmentLmsPublicationState` minus the `notRequested` case that only
// the multi-row aggregate needs.
export type PublicationActionResult =
  | {
      readonly kind: "succeeded";
      readonly outcome: IntegrationsPublicationOutcome;
    }
  | { readonly kind: "failed" }
  | { readonly kind: "permissionNotGranted" }
  | { readonly kind: "reconnectRequired" };

export type RunPublicationActionInput = {
  // The stable attempt nonce for this logical action. Reused on the single
  // automatic re-issue after consent.
  readonly nonce: string;
  // Issues one publish call with the given attempt nonce. The caller binds
  // the assignmentId, linkId, url, title, and optional topic; only the
  // nonce varies, and it never does within one logical action.
  readonly publish: (
    attemptNonce: string,
  ) => Promise<IntegrationsPublicationOutcome>;
  readonly consent: PublicationConsentSeam;
  readonly coordinator: ConsentCoordinator;
};

function classifyResolvedFailure(
  outcome: IntegrationsPublicationOutcome,
): "insufficientScope" | "reconnect" | "failed" {
  const code = outcome.errorCode;
  if (code === INSUFFICIENT_SCOPE_CODE) return "insufficientScope";
  if (code !== undefined && RECONNECT_ERROR_CODES.has(code)) return "reconnect";
  return "failed";
}

function classifyThrown(
  err: unknown,
): "insufficientScope" | "reconnect" | "failed" {
  const code = extractThrownErrorCode(err);
  if (code === INSUFFICIENT_SCOPE_CODE) return "insufficientScope";
  if (code !== undefined && RECONNECT_ERROR_CODES.has(code)) return "reconnect";
  return "failed";
}

// Run one logical publication action end to end: the initial publish, and,
// only for an insufficient-scope outcome, the incremental consent handoff
// plus exactly one automatic re-issue with the same nonce. Never loops:
// a re-issue that again returns insufficient scope stops and reports that
// permission was not granted (implementation plan §2.7, blueprint §7).
//
// A thrown callable error (deadline, transport, or a thrown platform error)
// is normalized to the same bounded result set as a graceful `status:
// "failed"` response. A publication outcome never undoes, deletes, or
// re-runs the authoritative LyfeLabz assignment lifecycle; this function
// only issues the publish side effect.
export async function runPublicationAction(
  input: RunPublicationActionInput,
): Promise<PublicationActionResult> {
  const { nonce, publish, consent, coordinator } = input;

  let first: IntegrationsPublicationOutcome;
  try {
    first = await publish(nonce);
  } catch (err) {
    const kind = classifyThrown(err);
    if (kind === "reconnect") return { kind: "reconnectRequired" };
    // The frozen server contract returns `lms.insufficientScope` as a
    // resolved outcome, never as a thrown error, so the consent handoff is
    // driven only from the resolved path below. Any thrown error here -
    // transport, deadline, or an unexpected thrown scope code - is treated
    // as a generic failure. It is never used to open the consent flow, so a
    // thrown channel can never start a consent loop.
    return { kind: "failed" };
  }

  if (first.status === "succeeded") {
    return { kind: "succeeded", outcome: first };
  }

  const firstKind = classifyResolvedFailure(first);
  if (firstKind === "reconnect") return { kind: "reconnectRequired" };
  if (firstKind === "failed") return { kind: "failed" };

  // Insufficient scope: run incremental consent exactly once (bounded by
  // the coordinator), then re-issue the publish exactly once with the same
  // nonce.
  const consentResult = await coordinator.ensureConsent(consent);
  if (consentResult !== "granted") {
    return { kind: "permissionNotGranted" };
  }

  let second: IntegrationsPublicationOutcome;
  try {
    second = await publish(nonce);
  } catch (err) {
    const kind = classifyThrown(err);
    if (kind === "reconnect") return { kind: "reconnectRequired" };
    return { kind: "failed" };
  }

  if (second.status === "succeeded") {
    return { kind: "succeeded", outcome: second };
  }
  const secondKind = classifyResolvedFailure(second);
  if (secondKind === "insufficientScope") {
    // Consent completed but the coursework scope was still not granted.
    // Stop. Do not reopen OAuth. Do not re-issue again.
    return { kind: "permissionNotGranted" };
  }
  if (secondKind === "reconnect") return { kind: "reconnectRequired" };
  return { kind: "failed" };
}

// -----------------------------------------------------------------------------
// Session-scoped publication retry context (client only)
// -----------------------------------------------------------------------------
//
// The detail-view retry entry point needs the minimal context to re-issue a
// publish for a class whose publication did not succeed: the linkId, the
// provider id, the LyfeLabz assignment URL, the title, and the optional
// topic (blueprint §8, §12). That context is recorded by the Assign confirm
// path when a publication is requested, and read by the entry point when it
// opens the detail view. It is in-memory only, uid-scoped so a same-tab
// teacher swap cannot leak a prior teacher's context, and never persisted.

export type LmsPublicationRetryContext = {
  readonly assignmentId: string;
  readonly linkId: string;
  readonly providerId: string;
  readonly lyfelabzAssignmentUrl: string;
  readonly title: string;
  readonly lmsTopicId?: string;
  readonly state: AssignmentLmsPublicationState;
};

let retryStore: {
  readonly uid: string;
  readonly byAssignmentId: Map<string, LmsPublicationRetryContext>;
} | null = null;

export function recordLmsPublicationRetryContext(
  uid: string,
  context: LmsPublicationRetryContext,
): void {
  if (retryStore === null || retryStore.uid !== uid) {
    retryStore = { uid, byAssignmentId: new Map() };
  }
  retryStore.byAssignmentId.set(context.assignmentId, context);
}

export function readLmsPublicationRetryContext(
  uid: string,
  assignmentId: string,
): LmsPublicationRetryContext | null {
  if (retryStore === null || retryStore.uid !== uid) return null;
  return retryStore.byAssignmentId.get(assignmentId) ?? null;
}

export function clearLmsPublicationRetryContexts(): void {
  retryStore = null;
}

// Build the detail-view retry seam for an assignment, or null when there is
// no recorded publication that did not succeed. The seam runs the same
// bounded single-consent-then-one-re-issue workflow as the confirm path,
// with a fresh nonce (a retry is a distinct logical action, implementation
// plan §2.1) and a fresh consent coordinator, and never re-runs the
// LyfeLabz assignment lifecycle. On resolution it updates the recorded
// context state so a subsequent open reflects the latest outcome.
export function createDetailLmsRetrySeam(input: {
  readonly uid: string;
  readonly assignmentId: string;
  readonly integrations: IntegrationsDeps | null;
  readonly onReconnect?: () => void;
}): AssignmentLmsRetrySeam | null {
  const { uid, assignmentId, integrations, onReconnect } = input;
  if (integrations === null) return null;
  const context = readLmsPublicationRetryContext(uid, assignmentId);
  if (context === null) return null;
  if (context.state === "succeeded") return null;

  const consent: PublicationConsentSeam = {
    providerId: context.providerId,
    beginConnection: integrations.callables.beginConnection,
    completeConnection: integrations.callables.completeConnection,
    openOAuth: integrations.openOAuth,
    redirectUri: integrations.redirectUri,
  };

  return Object.freeze({
    initialState: context.state,
    retry: async (): Promise<AssignmentLmsPublicationState> => {
      const nonce = mintNonce();
      const coordinator = createConsentCoordinator();
      const result = await runPublicationAction({
        nonce,
        publish: (attemptNonce) =>
          integrations.callables.publishAssignment({
            assignmentId,
            linkId: context.linkId,
            lyfelabzAssignmentUrl: context.lyfelabzAssignmentUrl,
            title: context.title,
            ...(context.lmsTopicId !== undefined && context.lmsTopicId !== ""
              ? { lmsTopicId: context.lmsTopicId }
              : {}),
            attemptNonce,
          }),
        consent,
        coordinator,
      });
      const nextState: AssignmentLmsPublicationState = result.kind;
      recordLmsPublicationRetryContext(uid, { ...context, state: nextState });
      return nextState;
    },
    ...(onReconnect !== undefined ? { onReconnect } : {}),
  });
}

// Test-only reset for the session-scoped retry store.
export function _resetLmsPublicationStateForTest(): void {
  retryStore = null;
}
