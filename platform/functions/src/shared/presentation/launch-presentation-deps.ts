import { Timestamp } from "firebase-admin/firestore";

import { isDifferentiatedDeliveryEnabled } from "../config/differentiated-delivery-flag";
import {
  launchGrantCreationDocRef,
  presentationVariantIndexDocRef,
  presentationVariantScopedIndexDocRef,
} from "../firestore/typed-ref";
import { studentAccommodationDocRef } from "../firestore/typed-ref";
import { log } from "../logging/logger";
import { PlatformError } from "../errors/platform-error";
import { variantKeyForReadingLevel } from "../types/presentation-variant";
import {
  assertLaunchGrantPairInvariant,
  computeGrantExpiryMs,
} from "../types/launch-grant";
import { generateGrantId } from "./launch-grant-id";
import { readRevisionCoverageWith } from "./revision-coverage-deps";
import {
  createLaunchPresentationResolver,
  type LaunchPresentationResolver,
  type LaunchPresentationResolverPorts,
  type LaunchPresentationTelemetryEvent,
  type MintGrantInput,
  type ReadingResolution,
  type VariantIndexEvaluation,
} from "./resolve-launch-presentation";

// F5.2 §4 Op C - real port wiring for the Slice 4 launch-presentation
// resolver. Binds the pure decision core
// (`./resolve-launch-presentation`) to Firestore (accommodation record +
// current-presentation index + launch-grant minting), the server-owned
// operational flag (§8.6), and the platform telemetry logger. Everything
// here is a thin adapter; the decision table itself lives in the pure core.

// Read the trusted accommodation record for the authenticated student and
// collapse it to a reading resolution. Absent record or `inactive` status ->
// `{active:false}` (EXPECTED_CANONICAL). Only an `active` status yields a
// level. The student never supplies any of this.
async function readReading(studentId: string): Promise<ReadingResolution> {
  const snapshot = await studentAccommodationDocRef(studentId).get();
  if (!snapshot.exists) return { active: false };
  const data = snapshot.data();
  const reading = data?.readingAccessibility;
  if (reading && reading.status === "active") {
    const configRevision = data?.configRevision;
    return typeof configRevision === "number" && Number.isSafeInteger(configRevision) && configRevision >= 1
      ? { active: true, level: reading.level, configRevision }
      : { active: true, level: reading.level };
  }
  return { active: false };
}

// F5.3 Slice 9C-1: coverage for (lessonSlug, variantKey, frozen revision) is
// classified by the ONE shared revision-aware evaluator
// (`./revision-coverage`, wired in `./revision-coverage-deps`), the same one
// begin uses. Its legacy-record classification is exactly the former
// `readVariantIndex` one (charset gate -> absent; missing -> absent; retired ->
// retired; unknown status / identity mismatch / inconsistent activate write ->
// malformed). NO Hosting liveness fetch occurs here (§ "no hosting fetch during
// student resolution"): publication already byte-verified the artifact before
// the index pointer advanced, so runtime trusts a valid active record.
function readVariantIndex(
  lessonSlug: string,
  variantKey: string,
  assessmentRevisionId: string | undefined,
): Promise<VariantIndexEvaluation> {
  return readRevisionCoverageWith(
    { scopedRef: presentationVariantScopedIndexDocRef, legacyRef: presentationVariantIndexDocRef },
    {
      lessonSlug,
      variantKey,
      ...(assessmentRevisionId !== undefined ? { assessmentRevisionId } : {}),
    },
  );
}

// Mint one server-issued launch grant and return its opaque id. The grant id
// is 128-bit CSPRNG (32 lowercase hex); `issuedAt`/`expiresAt` are concrete
// server-derived `Timestamp`s (never client input, `expiresAt = issuedAt +
// 6h`); the §3.6 pair invariant is asserted before the write; and the doc is
// written with `.create()` so a (astronomically unlikely) id collision loops
// to a fresh id rather than overwriting an existing grant.
function makeMintGrant(nowMs: () => number) {
  return async function mintGrant(input: MintGrantInput): Promise<string> {
    assertLaunchGrantPairInvariant(input);
    const issuedAtMs = nowMs();
    const issuedAt = Timestamp.fromMillis(issuedAtMs);
    const expiresAt = Timestamp.fromMillis(computeGrantExpiryMs(issuedAtMs));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const grantId = generateGrantId();
      const base = {
        grantId,
        studentId: input.studentId,
        assignmentId: input.assignmentId,
        lessonSlug: input.lessonSlug,
        issuedAt,
        expiresAt,
      };
      const payload =
        input.outcomeAtIssuance === "differentiated"
          ? {
              ...base,
              outcomeAtIssuance: "differentiated" as const,
              variantKey: input.variantKey,
              presentationRevisionId: input.presentationRevisionId,
              ...(input.assessmentPresentationRevisionId !== undefined
                ? { assessmentPresentationRevisionId: input.assessmentPresentationRevisionId }
                : {}),
              ...(input.accommodationConfigRevision !== undefined
                ? { accommodationConfigRevision: input.accommodationConfigRevision }
                : {}),
            }
          : { ...base, outcomeAtIssuance: "canonicalFallback" as const };
      try {
        await launchGrantCreationDocRef(grantId).create(payload);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        if (code === 6 || code === "already-exists") continue;
        throw err;
      }
      return grantId;
    }
    throw new PlatformError(
      "launchGrants.idCollision",
      "Failed to allocate a unique launch grant id.",
    );
  };
}

// Best-effort, non-sensitive telemetry. A malformed index is a defect-severity
// anomaly (warn); an internal resolution failure is an error; every other
// event is operational info. No IEP/504 text, diagnosis, or plan data is ever
// logged. Logging is observability, not lifecycle - a logging throw never
// affects the resolution result.
function telemetry(event: LaunchPresentationTelemetryEvent): void {
  try {
    switch (event.type) {
      case "coverageMalformed":
        log.warn("differentiation.launchFallback", {
          reason: "coverageMalformed",
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
          variantKey: event.variantKey,
        });
        break;
      case "internalFailure":
        log.error("differentiation.launchInternalFailure", {
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
          error: event.error,
        });
        break;
      case "differentiatedResolved":
        log.info("differentiation.launchDifferentiated", {
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
          variantKey: event.variantKey,
          presentationRevisionId: event.presentationRevisionId,
          ...(event.assessmentPresentationRevisionId !== undefined
            ? { assessmentPresentationRevisionId: event.assessmentPresentationRevisionId }
            : {}),
        });
        break;
      case "coverageAssessmentMismatch":
        // Defect-adjacent: a published binding disagrees with an assignment's
        // frozen revision. Warn so it is visible.
        log.warn("differentiation.launchFallback", {
          reason: "coverageAssessmentMismatch",
          studentId: event.studentId,
          assignmentId: event.assignmentId,
          lessonSlug: event.lessonSlug,
          variantKey: event.variantKey,
        });
        break;
      default:
        log.info("differentiation.launchFallback", {
          reason: event.type,
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

// Build the real ports for one request. `nowMs` is injectable so tests can
// assert the exact TTL; production uses the server wall clock.
export function buildLaunchPresentationResolverPorts(
  nowMs: () => number = () => Date.now(),
): LaunchPresentationResolverPorts {
  return {
    readReading,
    isDeliveryEnabled: isDifferentiatedDeliveryEnabled,
    readVariantIndex,
    mintGrant: makeMintGrant(nowMs),
    telemetry,
    variantKeyForReadingLevel,
  };
}

// The single entry point the student launch surfaces (`lmsDeepLinkResolve`,
// `assignmentsListForStudent`) use. Returns a per-request resolver whose
// accommodation/flag reads are memoized and whose index reads are memoized per
// lesson (§7.3). Create one per request; call `resolve` once for a deep link
// or once per item for the assignment list.
export function createRequestLaunchPresentationResolver(): LaunchPresentationResolver {
  return createLaunchPresentationResolver(buildLaunchPresentationResolverPorts());
}
