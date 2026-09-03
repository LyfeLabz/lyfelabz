import { Timestamp } from "firebase-admin/firestore";

import { isDifferentiatedDeliveryEnabled } from "../config/differentiated-delivery-flag";
import { launchGrantCreationDocRef } from "../firestore/typed-ref";
import { presentationVariantIndexDocRef } from "../firestore/typed-ref";
import { studentAccommodationDocRef } from "../firestore/typed-ref";
import { log } from "../logging/logger";
import { PlatformError } from "../errors/platform-error";
import {
  assertActivateWriteConsistent,
  isValidLessonSlugForVariant,
  isValidVariantKey,
  variantKeyForReadingLevel,
} from "../types/presentation-variant";
import {
  assertLaunchGrantPairInvariant,
  computeGrantExpiryMs,
} from "../types/launch-grant";
import { generateGrantId } from "./launch-grant-id";
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
    return { active: true, level: reading.level };
  }
  return { active: false };
}

// Evaluate the current-presentation index for (lessonSlug, variantKey). Absent
// -> `absent`; `retired` status -> `retired`; `active` status is trusted only
// after a full internal-consistency check (doc identity, path/hash/id
// agreement) - any inconsistency, or an unknown status, is `malformed` so a
// defect can never be delivered as differentiated. NO Hosting liveness fetch
// occurs here (§ "no hosting fetch during student resolution"): Slice 3
// publication already byte-verified the artifact before the index pointer
// advanced, so runtime trusts a valid active index.
async function readVariantIndex(
  lessonSlug: string,
  variantKey: string,
): Promise<VariantIndexEvaluation> {
  // §5.1/M3 charset gate. A lessonSlug outside `^[a-z0-9-]+$` (e.g. a legacy
  // `lesson_g7_earths-layers` slug carrying underscores) can never participate
  // in variant publication, so no index doc can exist for it. That is a
  // legitimate COVERAGE GAP (`absent` -> canonicalFallback, §5.2 missing-
  // variant behavior), not an internal error: guard here so
  // `presentationVariantIndexDocId` never throws on a non-eligible slug and a
  // non-differentiable lesson resolves to truthful canonical fallback rather
  // than a misclassified internal failure.
  if (!isValidLessonSlugForVariant(lessonSlug) || !isValidVariantKey(variantKey)) {
    return { kind: "absent" };
  }
  const snapshot = await presentationVariantIndexDocRef(lessonSlug, variantKey).get();
  if (!snapshot.exists) return { kind: "absent" };
  const data = snapshot.data();
  if (!data) return { kind: "malformed" };
  if (data.status === "retired") return { kind: "retired" };
  if (data.status !== "active") return { kind: "malformed" };

  // Defense-in-depth internal consistency. The doc id is derived from
  // (lessonSlug, variantKey), so a mismatch is a data-invariant violation.
  if (data.lessonSlug !== lessonSlug || data.variantKey !== variantKey) {
    return { kind: "malformed" };
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
    return { kind: "malformed" };
  }
  return {
    kind: "active",
    variantKey: data.variantKey,
    presentationRevisionId: data.currentPresentationRevisionId,
    path: data.currentPath,
  };
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
