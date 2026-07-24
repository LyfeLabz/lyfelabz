import { logger } from "firebase-functions";
import {
  HttpsError,
  onCall,
  type CallableFunction,
  type CallableOptions,
  type CallableRequest,
  type FunctionsErrorCode,
} from "firebase-functions/v2/https";

import { PlatformError } from "./platform-error";

// Sprint 11C Remediation Slice 1 - Critical Finding C-3.
//
// Central translation layer that converts a `PlatformError` thrown from
// any callable handler into a Firebase `HttpsError` while preserving the
// canonical platform error identifier. Without this layer, an uncaught
// `PlatformError` reaches the Firebase runtime and is coerced into an
// `INTERNAL` server error whose payload discards the canonical `code`
// and message the platform contract requires callers to observe.
//
// The correction is centralized: every callable that opts into this
// wrapper receives the translation automatically. Individual callables
// are not rewritten; each `onCall(handler)` site swaps to
// `platformCallable(handler)` and the handler itself is unchanged.
//
// The canonical platform code is preserved on the wire in two places:
//   1. `HttpsError.message` remains the exact platform message.
//   2. `HttpsError.details` carries `{ code: platformCode }` so a
//      well-behaved client can read the canonical identifier from the
//      structured details even when the coarser Firebase `code` maps to a
//      shared bucket (e.g. `failed-precondition`).
//
// The Firebase `code` is derived by prefix. Prefixes match the canonical
// identifier space in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §25,
// `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, and
// `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17. Every
// unknown code falls back to `failed-precondition`, which is the
// conservative default for a business-rule refusal.

const AUTH_CODES = new Set([
  "unauthenticated",
  "claim-stale",
]);

const AUTH_SUFFIXES = [
  ".unauthenticated",
];

const PERMISSION_CODES = new Set([
  "role-forbidden",
  "district-mismatch",
  "district-unassigned",
  "school-district-mismatch",
  "claim-state-mismatch",
  "account-inactive",
]);

// Sprint 11D I-4/R-2. Namespaced-identifier suffixes that map to
// `permission-denied`. These are canonical business-rule denials expressed
// as `{domain}.{suffix}` throughout the callable surface, e.g.
// `assessmentAttempts.notOwned`, `submissions.forbidden`. Adding them here
// removes the pre-Sprint 11D reliance on exact-string matching so every
// namespaced form maps consistently without a per-call-site rewrite.
const PERMISSION_SUFFIXES = [
  ".unauthorized",
  ".forbidden",
  ".notOwned",
  ".notEnrolled",
];

const NOT_FOUND_SUFFIXES = [
  ".notFound",
  ".sessionNotFound",
  ".assignmentNotFound",
  ".revisionMissing",
  ".answerKeyMissing",
];

const CONFLICT_SUFFIXES = [
  ".conflict",
  ".writeConflict",
  ".alreadyExists",
];

const INVALID_ARG_SUFFIXES = [
  ".invalidRequest",
  ".invalidSessionId",
  ".invalidIdempotencyKey",
  ".invalidAssignmentId",
  ".invalidResponses",
  ".invalidScore",
  ".invalidSubmissionId",
  ".invalidDurationMs",
  ".invalidAttemptCount",
  ".invalidResponse",
  ".malformedSession",
];

function endsWithAny(code: string, suffixes: readonly string[]): boolean {
  for (const suffix of suffixes) {
    if (code.endsWith(suffix)) return true;
  }
  return false;
}

export function mapPlatformCodeToHttpsCode(code: string): FunctionsErrorCode {
  if (AUTH_CODES.has(code)) return "unauthenticated";
  if (endsWithAny(code, AUTH_SUFFIXES)) return "unauthenticated";
  if (PERMISSION_CODES.has(code)) return "permission-denied";
  if (endsWithAny(code, PERMISSION_SUFFIXES)) return "permission-denied";
  if (endsWithAny(code, NOT_FOUND_SUFFIXES)) return "not-found";
  if (endsWithAny(code, CONFLICT_SUFFIXES)) return "already-exists";
  if (endsWithAny(code, INVALID_ARG_SUFFIXES)) return "invalid-argument";
  if (code === "assignment-not-found") return "not-found";
  if (code === "session-not-found") return "not-found";
  if (code === "assessment-not-found") return "not-found";
  if (code === "assessment-revision-missing") return "not-found";
  return "failed-precondition";
}

// Diagnostic context passed by `platformCallable` so an unhandled throwable
// can be attributed to a specific callable in the server logs. The wrapper
// derives `callableName` from the handler function's `name`; every other
// caller may omit the context.
export type TranslateThrownContext = {
  readonly callableName?: string;
};

// Translate any thrown value into a Firebase-visible error. `PlatformError`
// is remapped as documented above; a native `HttpsError` passes through
// unchanged; every other value is coerced to `internal` so the runtime's
// default serializer does not leak stack traces.
//
// Diagnostic logging: an unhandled throwable (anything that is neither a
// `PlatformError` nor an `HttpsError`) is emitted exactly once as a
// structured `callable.unhandled` error event via the Firebase Functions
// logger before it is coerced to the generic client-facing internal
// error. Only safe diagnostic fields are captured: error name, message,
// stack, cause, and the callable name when the wrapper supplies it.
// Firebase ID tokens, authorization headers, secrets, request payloads,
// and student/teacher personal information are never logged here.
export function translateThrown(
  err: unknown,
  context?: TranslateThrownContext,
): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof PlatformError) {
    return new HttpsError(
      mapPlatformCodeToHttpsCode(err.code),
      err.message,
      { code: err.code },
    );
  }

  const payload: Record<string, unknown> = {};
  if (context?.callableName) payload.callableName = context.callableName;
  if (err instanceof Error) {
    payload.name = err.name;
    payload.message = err.message;
    if (typeof err.stack === "string") payload.stack = err.stack;
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) {
      if (cause instanceof Error) {
        payload.cause = {
          name: cause.name,
          message: cause.message,
          stack: cause.stack,
        };
      } else {
        payload.cause = String(cause);
      }
    }
  } else {
    payload.name = "NonError";
    payload.message = typeof err === "string" ? err : String(err);
  }
  logger.error("callable.unhandled", payload);

  return new HttpsError("internal", "An unexpected error occurred.");
}

// Factory used by every callable in the platform Cloud Function surface.
// Mirrors the signature of `onCall` from `firebase-functions/v2/https`
// so callers can drop it in with a single import change and no handler
// rewrite. See site-level comments on individual callables for the
// contract each handler enforces; the translation described here is the
// only added behavior.
export function platformCallable<T = unknown, R = unknown>(
  handler: (request: CallableRequest<T>) => R | Promise<R>,
): CallableFunction<T, R | Promise<R>>;
export function platformCallable<T = unknown, R = unknown>(
  options: CallableOptions,
  handler: (request: CallableRequest<T>) => R | Promise<R>,
): CallableFunction<T, R | Promise<R>>;
export function platformCallable<T = unknown, R = unknown>(
  optionsOrHandler:
    | CallableOptions
    | ((request: CallableRequest<T>) => R | Promise<R>),
  maybeHandler?: (request: CallableRequest<T>) => R | Promise<R>,
): CallableFunction<T, R | Promise<R>> {
  const handler =
    typeof optionsOrHandler === "function"
      ? optionsOrHandler
      : (maybeHandler as (request: CallableRequest<T>) => R | Promise<R>);
  const options =
    typeof optionsOrHandler === "function" ? undefined : optionsOrHandler;

  const callableName = handler.name || undefined;
  const wrapped = async (request: CallableRequest<T>): Promise<R> => {
    try {
      return await handler(request);
    } catch (err) {
      throw translateThrown(err, { callableName });
    }
  };

  if (options) {
    return onCall<T, R | Promise<R>>(options, wrapped);
  }
  return onCall<T, R | Promise<R>>(wrapped);
}
