import type {
  AssignmentLmsPublicationState,
  AssignmentLmsRetrySeam,
} from "../../../assignments/detail/types";
import type {
  IntegrationsCallables,
  IntegrationsDeps,
  IntegrationsPublicationOutcome,
  OAuthHandoff,
  OAuthWindowReservation,
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

// Sprint 26 Phase 4 (definition §7.E, §7.B). The backend hard-rejects an
// incremental publication authorization whose returned Google identity
// does not match the identity already associated with the durable
// connection (`connections-complete.ts`, `lms.identityMismatch`). That
// rejection reaches the client as a thrown callable error at the consent
// completion step. Before Phase 4 the consent handoff caught every throw
// alike and reported "permission not granted", flattening the mismatch
// into a generic permission failure. Phase 4 classifies it distinctly so
// the surfaces can give the specific same-account recovery guidance
// without exposing this raw code, OAuth terms, or any account identifier.
export const IDENTITY_MISMATCH_CODE = "lms.identityMismatch";

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
  // PDR-030i popup reliability. Present only on seams invoked directly from
  // a teacher click (the Assign dialog notice and confirm, Assignment Detail
  // Try again). The automatic after-publish fallback omits it: a window
  // reserved outside a click would be blocked anyway.
  readonly reserveOAuthWindow?: () => OAuthWindowReservation | null;
};

// Consent coordinator. Bounds every incremental-consent handoff for one
// logical scope (one confirm action, or one retry click) to at most one
// OAuth begin and one completion, even when several LMS-linked rows in the
// same confirm each return insufficient scope (definition Part 10, blueprint
// §7). The first row to need consent runs the handoff; concurrent rows
// await the same in-flight result and reuse the one completed consent. A
// declined or failed consent latches `notGranted` for the remainder of the
// action so no second OAuth flow is opened (no consent loop).
// The bounded result of one incremental-consent handoff. `identityMismatch`
// is distinguished from a generic `notGranted` decline so the surfaces can
// route the teacher to specific same-account recovery guidance (Phase 4,
// definition §7.E). Every other completion failure - popup blocked,
// cancelled, denied, state mismatch, transport - stays `notGranted`.
export type ConsentResult = "granted" | "notGranted" | "identityMismatch";

export type ConsentCoordinator = {
  readonly ensureConsent: (
    seam: PublicationConsentSeam,
  ) => Promise<ConsentResult>;
};

// -----------------------------------------------------------------------------
// Unified onboarding authorization (teacher-initiated upgrade)
// -----------------------------------------------------------------------------
//
// October 2026 incident: a teacher whose connection carried only the
// read-only roster permissions saw an empty topic list and four assignments
// that never reached Classroom. The automatic consent handoff below runs only
// after the create/publish round trips, outside the click that started them,
// so a browser popup blocker can stop it. The surfaces therefore ask for the
// one missing authorization up front, from a direct teacher click, using the
// detailed result here so each outcome gets specific, non-technical guidance.
export type ClassroomAuthorizationResult =
  | "granted"
  // The teacher declined, or approved only some of the Classroom
  // permissions (Google lets individual permissions be unchecked).
  | "declined"
  | "popupBlocked"
  // The Google window was closed before a decision.
  | "cancelled"
  | "identityMismatch"
  | "failed";

function readHandoffErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

// Run one publication authorization: begin (complete permission set), the
// browser handoff, and completion. Call it directly from a teacher click so
// the Google window opens inside the user gesture. Never retries itself and
// never publishes anything.
export async function requestPublicationAuthorization(
  seam: PublicationConsentSeam,
): Promise<ClassroomAuthorizationResult> {
  // Reserve the Google window BEFORE the first await, while this call is
  // still inside the teacher's click. Released in `finally` on every path
  // (idempotent; a window the handoff used is already closed).
  const reservation = seam.reserveOAuthWindow?.() ?? null;
  try {
    return await runPublicationAuthorization(seam, reservation);
  } finally {
    reservation?.close();
  }
}

async function runPublicationAuthorization(
  seam: PublicationConsentSeam,
  reservation: OAuthWindowReservation | null,
): Promise<ClassroomAuthorizationResult> {
  let begun: { readonly authorizationUrl: string; readonly state: string };
  try {
    begun = await seam.beginConnection({
      providerId: seam.providerId,
      redirectUri: seam.redirectUri,
      capability: "publication",
    });
  } catch {
    return "failed";
  }
  let handed: { readonly code: string; readonly state: string };
  try {
    handed = await seam.openOAuth({
      authorizationUrl: begun.authorizationUrl,
      redirectUri: seam.redirectUri,
      expectedState: begun.state,
      reservation,
    });
  } catch (err) {
    const code = readHandoffErrorCode(err);
    if (code === "popup-blocked") return "popupBlocked";
    if (code === "cancelled") return "cancelled";
    // Google's callback reports a refused consent as `access_denied`.
    if (code === "access_denied") return "declined";
    return "failed";
  }
  try {
    const completed = await seam.completeConnection({
      providerId: seam.providerId,
      code: handed.code,
      state: handed.state,
      redirectUri: seam.redirectUri,
    });
    // An absent flag (server predating unified authorization) keeps the
    // earlier behavior: a completed consent counts as granted and the
    // publish re-issue remains the authoritative test.
    return completed.publicationAuthorized === false ? "declined" : "granted";
  } catch (err) {
    // A completion-time identity mismatch is a distinct recovery outcome:
    // the teacher authorized with a different Google account than the one
    // on the durable connection. The existing connection is untouched
    // (the backend hard-rejects before any mutation, definition §7.B); the
    // teacher simply needs to retry with the same account. Only the stable
    // sanitized code is inspected; the raw error is never surfaced.
    if (extractThrownErrorCode(err) === IDENTITY_MISMATCH_CODE) {
      return "identityMismatch";
    }
    return "failed";
  }
}

// Teacher-facing guidance for each authorization result. Plain language:
// no OAuth term, scope string, error code, or account identifier.
export const CLASSROOM_AUTHORIZATION_MESSAGE: Readonly<
  Record<ClassroomAuthorizationResult, string>
> = Object.freeze({
  granted:
    "Google Classroom access is ready. Topics and posting to Classroom will work from now on.",
  declined:
    "Google Classroom access was not fully approved. Choose Allow Google Classroom access again and leave every Classroom permission checked.",
  popupBlocked:
    "Your browser blocked the Google window. Allow pop-ups for LyfeLabz, then choose Allow Google Classroom access again.",
  cancelled:
    "The Google window closed before access was approved. Choose Allow Google Classroom access to try again.",
  identityMismatch:
    "Choose the same Google account you first connected to Google Classroom, then try again.",
  failed:
    "Google Classroom access could not be set up just now. Check your connection and try again in a moment.",
});

// Why a Classroom topic list could not be loaded. Kept distinct from a class
// that genuinely has no topics, which loads successfully as an empty list.
export type TopicLoadFailure = "permission" | "reconnect" | "unavailable";

const TOPIC_RECONNECT_CODES: ReadonlySet<string> = new Set([
  ...RECONNECT_ERROR_CODES,
  "lms.reconnectRequired",
  "lms.upstreamAuthorizationFailed",
]);

export function classifyTopicLoadError(err: unknown): TopicLoadFailure {
  const code = extractThrownErrorCode(err);
  if (code === INSUFFICIENT_SCOPE_CODE) return "permission";
  if (code !== undefined && TOPIC_RECONNECT_CODES.has(code)) return "reconnect";
  // Network, deadline, provider outage, or anything unrecognized.
  return "unavailable";
}

async function runConsentHandoff(
  seam: PublicationConsentSeam,
): Promise<ConsentResult> {
  // Popup blocked, cancelled, denied, partially approved, state mismatch, or
  // a completion failure all stop here as `notGranted`. No second automatic
  // OAuth attempt is made; the caller stops and offers manual retry.
  const result = await requestPublicationAuthorization(seam);
  if (result === "granted") return "granted";
  if (result === "identityMismatch") return "identityMismatch";
  return "notGranted";
}

// A coordinator whose single consent for the action has already been
// decided, so `runPublicationAction` never opens another Google window.
function settledConsentCoordinator(result: ConsentResult): ConsentCoordinator {
  return { ensureConsent: () => Promise.resolve(result) };
}

export function createConsentCoordinator(): ConsentCoordinator {
  let inFlight: Promise<ConsentResult> | null = null;
  let settled: ConsentResult | null = null;
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
  | { readonly kind: "identityMismatch" }
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
  if (consentResult === "identityMismatch") {
    // The teacher authorized with a different Google account. The durable
    // connection is intact; the surfaces render same-account recovery
    // guidance and the teacher can retry (definition §7.E). No re-issue.
    return { kind: "identityMismatch" };
  }
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
// provider id, the title, and the optional topic (blueprint §8, §12). That
// context is recorded by the Assign confirm path when a publication is
// requested, and read by the entry point when it opens the detail view. It is
// in-memory only, uid-scoped so a same-tab teacher swap cannot leak a prior
// teacher's context, and never persisted.
//
// Sprint 27 Phase 4 (blueprint Decision 4): the LyfeLabz assignment URL is no
// longer carried here. The publish callable constructs the Classroom
// destination server-side from the authoritative assignmentId, so the client
// retry context neither holds nor sends a destination URL.
export type LmsPublicationRetryContext = {
  readonly assignmentId: string;
  readonly linkId: string;
  readonly providerId: string;
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

// -----------------------------------------------------------------------------
// Session-scoped connection-recovery signal (client only)
// -----------------------------------------------------------------------------
//
// Sprint 26 Phase 4 (definition §7.F, §8). LyfeLabz has no durable backend
// "connection needs reauthorization" field: the connection document status
// is only `active` or `revoked`, and the `reconnectRequired` health verdict
// is computed per class-refresh, never persisted on the connection. So the
// only condition LyfeLabz can honestly know is one it has actually observed
// this session: a publication attempt that returned a connection-not-usable
// outcome (`reconnectRequired`). This store records that observation so the
// Settings surface can surface an "action needed" state with a real
// reconnect action rather than a dead-end, and so it honestly forgets on
// reload (a fresh session re-derives the signal from the next attempt).
//
// It is session-local, in-memory, uid-scoped, and never persisted - the
// same posture as the retry-context store above. It records ONLY the
// reconnect-required condition. Identity mismatch is deliberately excluded:
// its recovery lives in the publication surfaces (retry with the same
// account), and it must not turn Settings into a misleading destination
// (definition §7.E, §18). The signal never carries any Google identity,
// token, scope, or error code.
let connectionRecoveryStore: {
  readonly uid: string;
  readonly providers: Set<string>;
} | null = null;

export function recordConnectionReconnectNeeded(
  uid: string,
  providerId: string,
): void {
  if (connectionRecoveryStore === null || connectionRecoveryStore.uid !== uid) {
    connectionRecoveryStore = { uid, providers: new Set() };
  }
  connectionRecoveryStore.providers.add(providerId);
}

export function readConnectionReconnectNeeded(
  uid: string,
  providerId: string,
): boolean {
  if (connectionRecoveryStore === null || connectionRecoveryStore.uid !== uid) {
    return false;
  }
  return connectionRecoveryStore.providers.has(providerId);
}

export function clearConnectionReconnectNeeded(
  uid: string,
  providerId: string,
): void {
  if (connectionRecoveryStore === null || connectionRecoveryStore.uid !== uid) {
    return;
  }
  connectionRecoveryStore.providers.delete(providerId);
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

  // The after-publish fallback consent runs outside the click, so it never
  // reserves a window; only the up-front request below (still inside the
  // Try again click) does.
  const consent: PublicationConsentSeam = {
    providerId: context.providerId,
    beginConnection: integrations.callables.beginConnection,
    completeConnection: integrations.callables.completeConnection,
    openOAuth: integrations.openOAuth,
    redirectUri: integrations.redirectUri,
  };
  const clickConsent: PublicationConsentSeam =
    integrations.reserveOAuthWindow !== undefined
      ? { ...consent, reserveOAuthWindow: integrations.reserveOAuthWindow }
      : consent;

  return Object.freeze({
    initialState: context.state,
    retry: async (): Promise<AssignmentLmsPublicationState> => {
      const nonce = mintNonce();
      let coordinator = createConsentCoordinator();
      // Unified onboarding authorization: when the last attempt stopped for
      // missing Classroom permission, ask for it FIRST, directly from this
      // Try again click, so the Google window is not opened after a
      // publish round trip (where popup blockers stop it). A refusal
      // publishes nothing.
      if (context.state === "permissionNotGranted") {
        const authorization = await requestPublicationAuthorization(clickConsent);
        if (authorization !== "granted") {
          const stopped: AssignmentLmsPublicationState =
            authorization === "identityMismatch"
              ? "identityMismatch"
              : "permissionNotGranted";
          recordLmsPublicationRetryContext(uid, { ...context, state: stopped });
          return stopped;
        }
        // Already authorized for this action: never open a second window.
        coordinator = settledConsentCoordinator("notGranted");
      }
      const result = await runPublicationAction({
        nonce,
        publish: (attemptNonce) =>
          integrations.callables.publishAssignment({
            assignmentId,
            linkId: context.linkId,
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
      // Keep the session-local Settings recovery signal honest: a retry that
      // still finds the connection unusable arms "action needed" in Settings;
      // any other terminal outcome (including a now-successful publish) clears
      // it. Identity mismatch never arms it (definition §7.E, §7.F).
      if (result.kind === "reconnectRequired") {
        recordConnectionReconnectNeeded(uid, context.providerId);
      } else {
        clearConnectionReconnectNeeded(uid, context.providerId);
      }
      return nextState;
    },
    ...(onReconnect !== undefined ? { onReconnect } : {}),
  });
}

// Test-only reset for the session-scoped client stores.
export function _resetLmsPublicationStateForTest(): void {
  retryStore = null;
  connectionRecoveryStore = null;
}
