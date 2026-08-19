import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type {
  DeepLinkAttemptContext,
  DeepLinkInternalTarget,
  DeepLinkResolution,
  DeepLinkResolveCallable,
} from "./types";

// Sprint 27 Phase 4 entry-point wiring for the certified `lmsDeepLinkResolve`
// callable. This module is the seam that keeps the deep-link arrival surface
// free of firebase/* imports. It is imported only by src/index.ts and follows
// the pattern established by studentResults/wire.ts and studentList/wire.ts.
//
// The backend is authoritative for authorization, enrollment, district, and
// recipient enforcement; this wire never derives, aggregates, or authorizes.
// It sends only the assignmentId and defensively parses the response, failing
// closed (throwing) when the server returns a shape the client cannot trust,
// so a broken or laundered response can never silently route a student into
// an unauthorized runtime.

type CallableRecord = Readonly<Record<string, unknown>>;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

const INTERNAL_TARGETS: readonly DeepLinkInternalTarget[] = [
  "assignmentLaunch",
  "lessonPractice",
  "informational",
];

const ATTEMPT_CONTEXTS: readonly DeepLinkAttemptContext[] = [
  "authorized",
  "informational",
];

function parseResolution(raw: unknown): DeepLinkResolution {
  const record = (raw ?? {}) as CallableRecord;
  const assignmentId = record.assignmentId;
  const classId = record.classId;
  const lessonSlug = record.lessonSlug;
  const internalTarget = record.internalTarget;
  const attemptContext = record.attemptContext;
  if (
    !isNonEmptyString(assignmentId) ||
    !isNonEmptyString(classId) ||
    !isNonEmptyString(lessonSlug) ||
    typeof internalTarget !== "string" ||
    !(INTERNAL_TARGETS as readonly string[]).includes(internalTarget) ||
    typeof attemptContext !== "string" ||
    !(ATTEMPT_CONTEXTS as readonly string[]).includes(attemptContext)
  ) {
    // Fail closed: a malformed resolution is treated as a resolver failure,
    // not a silent launch. The arrival surface renders a recoverable error.
    throw new Error("deep-link resolution response was malformed");
  }
  // Defense in depth: `authorized` may only pair with `assignmentLaunch`. Any
  // other pairing is a broken contract and must not launch the runtime.
  if (attemptContext === "authorized" && internalTarget !== "assignmentLaunch") {
    throw new Error("deep-link resolution response was inconsistent");
  }
  return Object.freeze({
    assignmentId,
    classId,
    lessonSlug,
    internalTarget: internalTarget as DeepLinkInternalTarget,
    attemptContext: attemptContext as DeepLinkAttemptContext,
  });
}

export function createDeepLinkResolveCallable(
  functions: Functions,
): DeepLinkResolveCallable {
  const callable = httpsCallable(functions, "lmsDeepLinkResolve");
  return async (input) => {
    // The assignmentId is the sole payload; caller identity is the
    // authorization source (PDR-027 §10). No student, class, school, or
    // district identifier is ever sent from the browser.
    const res = await callable({ assignmentId: input.assignmentId });
    return parseResolution(res.data);
  };
}
