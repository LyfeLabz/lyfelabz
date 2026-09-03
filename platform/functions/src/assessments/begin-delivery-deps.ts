import {
  assertActivateWriteConsistent,
  isDifferentiatedDeliveryEnabled,
  isValidGrantId,
  isValidLessonSlugForVariant,
  isValidVariantKey,
  launchGrantDocRef,
  log,
  presentationVariantIndexDocRef,
  studentAccommodationDocRef,
  variantKeyForReadingLevel,
} from "../shared";
import type { ReadingResolution } from "../shared";

import {
  type BeginCoverageKind,
  type BeginDeliveryPorts,
  type BeginDeliveryTelemetryEvent,
  type RawLaunchGrant,
} from "./resolve-begin-delivery";

// F5.2 §8 - real port wiring for the Slice 6 begin-time delivery resolver.
// Binds the pure decision core (`./resolve-begin-delivery`) to Firestore (the
// launch grant, the accommodation record, the current-presentation index), the
// server-owned operational flag (§8.6), and the platform telemetry logger.
// Everything here is a thin adapter; the decision table lives in the pure core.

// Read the launch grant by opaque id. Returns the raw record for defensive
// validation in the core, or `undefined` when no such grant exists. The token
// is NEVER logged here.
async function readGrant(grantId: string): Promise<RawLaunchGrant | undefined> {
  const snapshot = await launchGrantDocRef(grantId).get();
  if (!snapshot.exists) return undefined;
  const data = snapshot.data();
  if (!data) return undefined;
  return data;
}

// Trusted accommodation read (identical collapse to the Slice 4 resolver's
// `readReading`): absent record or `inactive` status -> `{active:false}`; only
// an `active` status yields a level. The student never supplies any of this.
async function readAccommodation(studentId: string): Promise<ReadingResolution> {
  const snapshot = await studentAccommodationDocRef(studentId).get();
  if (!snapshot.exists) return { active: false };
  const data = snapshot.data();
  const reading = data?.readingAccessibility;
  if (reading && reading.status === "active") {
    return { active: true, level: reading.level };
  }
  return { active: false };
}

// Begin-time coverage classification for (lessonSlug, variantKey). Mirrors the
// Slice 4 resolver's `readVariantIndex` classification EXACTLY (charset gate ->
// absent; missing doc -> absent; retired -> retired; unknown status / identity
// mismatch / inconsistent activate write -> malformed; else active) but returns
// a KIND ONLY. It is structurally incapable of returning a revision, enforcing
// the §8.2 "must not select or freeze a presentation revision" invariant. A
// thrown read propagates to the core, which fails closed
// (BEGIN_VALIDATION_UNAVAILABLE, §8.3).
async function readCoverage(
  lessonSlug: string,
  variantKey: string,
): Promise<BeginCoverageKind> {
  // A lessonSlug outside the variant charset (e.g. a legacy underscore slug)
  // can never carry an index doc -> a legitimate coverage gap, not an error.
  if (!isValidLessonSlugForVariant(lessonSlug) || !isValidVariantKey(variantKey)) {
    return "absent";
  }
  const snapshot = await presentationVariantIndexDocRef(lessonSlug, variantKey).get();
  if (!snapshot.exists) return "absent";
  const data = snapshot.data();
  if (!data) return "malformed";
  if (data.status === "retired") return "retired";
  if (data.status !== "active") return "malformed";
  if (data.lessonSlug !== lessonSlug || data.variantKey !== variantKey) {
    return "malformed";
  }
  try {
    assertActivateWriteConsistent({
      lessonSlug: data.lessonSlug,
      variantKey: data.variantKey,
      currentPresentationRevisionId: data.currentPresentationRevisionId,
      currentPath: data.currentPath,
      contentSha256: data.contentSha256,
    });
  } catch {
    return "malformed";
  }
  return "active";
}

// Best-effort, non-sensitive telemetry. Never logs the raw `launchRef` token,
// IEP/504 text, a diagnosis, or plan data. Logging is observability, not
// lifecycle - a logging throw never affects the begin result.
function telemetry(event: BeginDeliveryTelemetryEvent): void {
  try {
    switch (event.type) {
      case "grantInvalid":
        // Security-relevant: a forged/mismatched/malformed grant reached begin.
        log.warn("differentiation.beginGrantInvalid", {
          reason: event.reason,
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
        });
        break;
      case "grantExpired":
        log.info("differentiation.beginGrantExpired", {
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
        });
        break;
      case "differentiatedBound":
        log.info("differentiation.beginDifferentiated", {
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
          variantKey: event.variantKey,
          presentationRevisionId: event.presentationRevisionId,
        });
        break;
      case "beginRequiresLaunch":
        // Operationally important: available required support was NOT suppressed
        // by an omitted ref (the P1 defense fired).
        log.warn("differentiation.beginRequiresLaunch", {
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
          variantKey: event.variantKey,
        });
        break;
      case "beginValidationUnavailable":
        log.error("differentiation.beginValidationUnavailable", {
          reason: event.reason,
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
        });
        break;
      case "canonicalFallbackBound":
        log.info("differentiation.beginCanonicalFallback", {
          source: "grant",
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
        });
        break;
      case "noRefFallback":
      default:
        log.info("differentiation.beginCanonicalFallback", {
          source: "noRef",
          reason: event.reason,
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
          variantKey: event.variantKey,
        });
        break;
    }
  } catch {
    // Observability only.
  }
}

// Build the real ports for one begin call. `nowMs` is injectable so tests can
// assert the exact expiry boundary; production uses the server wall clock.
export function buildBeginDeliveryPorts(
  nowMs: () => number = () => Date.now(),
): BeginDeliveryPorts {
  return {
    readGrant,
    readAccommodation,
    isDeliveryEnabled: isDifferentiatedDeliveryEnabled,
    readCoverage,
    variantKeyForReadingLevel,
    isValidGrantId,
    telemetry,
    nowMs,
  };
}
