import type { ReadingLevel } from "../types/student-accommodation";

// F5.2 §4 Op C / §8.5 / §8.6 - student presentation resolution, Persistent
// Student Differentiation Slice 4.
//
// This is the PURE core of Op C: the server-authoritative decision of which
// presentation an authenticated student launch resolves to, plus the grant
// minting that produces the non-forgeable launch reference. It is a pure
// orchestrator - every side effect (reading the accommodation record, reading
// the operational flag, reading the current-presentation index, minting a
// launch grant, emitting telemetry) is an INJECTED PORT, mirroring the Slice 3
// publication state machine. It imports no firebase-admin, crypto, or config
// module, so the whole decision table is unit-testable with fakes.
//
// ROOT RESOLUTION PRINCIPLE (§ "resolution inputs", §11). The student never
// chooses or asserts their presentation. Resolution derives entirely from the
// authenticated `studentId` (equal to `actor.uid` at the calling surface),
// the assignment-frozen `lessonSlug`, trusted accommodation state, the
// server-owned operational flag, and the server-owned index. The student
// never supplies `variantKey`, `presentationRevisionId`, a path, an
// accommodation status/level, or grant contents.
//
// FAIL-SAFE DIRECTION (§8.5 rows 3-8, §12). At the RESOLVER, canonical is the
// safe degradation: any internal failure (a read error, a grant-mint error)
// yields a canonical response with NO grant and telemetry, never a refusal and
// never a false claim of differentiated delivery. (Refusal is the safe
// direction only at the durable freeze point - `assessmentSessionsBegin`,
// Slice 6 - which is out of scope here.)
//
// The exact §4 Op C / §8.5 decision table implemented by `resolve`:
//   - No accommodation record / inactive  -> EXPECTED_CANONICAL: no grant, no
//     presentation. (rows 1-2)
//   - Active + delivery operationally disabled (§8.6) -> canonicalFallback
//     grant, operational-disable telemetry, launchRef only, never
//     differentiated. (row 14)
//   - Active + index absent  -> canonicalFallback grant, coverage telemetry.
//     (row 3)
//   - Active + index retired -> canonicalFallback grant, withdrawal telemetry.
//     (row 4)
//   - Active + index malformed -> canonicalFallback grant + defect-severity
//     anomaly telemetry (§4 Op C "Malformed index -> same, plus
//     defect-severity anomaly"). (row 5, resolve column)
//   - Active + valid ACTIVE index + delivery enabled -> differentiated grant
//     binding the index's current pair; presentation + launchRef. (row-G)
//   - Internal failure at any step -> canonical response, telemetry, NO grant.
//     (row 8)

// Trusted accommodation resolution. `active:false` collapses both "no record"
// and "record present but inactive" - both are EXPECTED_CANONICAL and
// indistinguishable at resolution (§8.5 rows 1-2).
export type ReadingResolution =
  | { readonly active: false }
  | { readonly active: true; readonly level: ReadingLevel };

// Evaluation of the current-presentation index for one (lessonSlug,
// variantKey). Only `"active"` (an internally-consistent, non-retired index
// doc) can support differentiated resolution; every other state is a
// legitimate or defect-driven fallback.
export type VariantIndexEvaluation =
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "malformed" }
  | {
      readonly kind: "active";
      readonly variantKey: string;
      readonly presentationRevisionId: string;
      readonly path: string;
    };

// The server-selected differentiated pair + path returned to the calling
// surface (§7.1). Never carries an accommodation level, status, configRevision,
// or Firestore path beyond the opaque `path`.
export type LaunchPresentation = {
  readonly variantKey: string;
  readonly presentationRevisionId: string;
  readonly path: string;
};

export type LaunchFallbackReason =
  | "operationalDisable"
  | "coverageAbsent"
  | "coverageRetired"
  | "coverageMalformed";

// The Op C result. Only `differentiated` carries a `presentation`; only
// `differentiated` and `canonicalFallback` carry a `launchRef`.
export type LaunchPresentationResolution =
  | { readonly kind: "expectedCanonical" }
  | { readonly kind: "internalFailure" }
  | {
      readonly kind: "canonicalFallback";
      readonly launchRef: string;
      readonly reason: LaunchFallbackReason;
    }
  | {
      readonly kind: "differentiated";
      readonly launchRef: string;
      readonly presentation: LaunchPresentation;
    };

export type MintGrantInput =
  | {
      readonly outcomeAtIssuance: "canonicalFallback";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
    }
  | {
      readonly outcomeAtIssuance: "differentiated";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
      readonly presentationRevisionId: string;
    };

// Non-sensitive telemetry events (§ telemetry, §11). Carries only operational
// identifiers and the fallback reason - never IEP/504 text, a diagnosis, or an
// accommodation plan. `variantKey` (e.g. "reading-adapted") is presentation
// identity, not plan data, so it is safe to carry for coverage debugging.
export type LaunchPresentationTelemetryEvent =
  | {
      readonly type: "operationalDisable";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
    }
  | {
      readonly type: "coverageAbsent";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
    }
  | {
      readonly type: "coverageRetired";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
    }
  | {
      readonly type: "coverageMalformed";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
    }
  | {
      readonly type: "internalFailure";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly error: string;
    }
  | {
      readonly type: "differentiatedResolved";
      readonly studentId: string;
      readonly assignmentId: string;
      readonly lessonSlug: string;
      readonly variantKey: string;
      readonly presentationRevisionId: string;
    };

export type LaunchPresentationResolverPorts = {
  // Trusted accommodation read for the authenticated student.
  readonly readReading: (studentId: string) => Promise<ReadingResolution>;
  // Server-owned operational differentiated-delivery flag (§8.6).
  readonly isDeliveryEnabled: () => Promise<boolean>;
  // Current-presentation index evaluation for (lessonSlug, variantKey).
  readonly readVariantIndex: (
    lessonSlug: string,
    variantKey: string,
  ) => Promise<VariantIndexEvaluation>;
  // Mint one server-issued launch grant and return its opaque id.
  readonly mintGrant: (input: MintGrantInput) => Promise<string>;
  // Best-effort, non-sensitive telemetry.
  readonly telemetry: (event: LaunchPresentationTelemetryEvent) => void;
  // Derive the logical variant key from a reading level (injected so the core
  // needs no dependency on the presentation-variant module).
  readonly variantKeyForReadingLevel: (level: ReadingLevel) => string;
};

export type ResolveLaunchPresentationInput = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly lessonSlug: string;
};

export type LaunchPresentationResolver = {
  readonly resolve: (
    input: ResolveLaunchPresentationInput,
  ) => Promise<LaunchPresentationResolution>;
};

// Create a per-request resolver. The accommodation read and the operational
// flag read are MEMOIZED for the life of the resolver (§7.3 "one accommodation
// read per call + one index read per distinct differentiated lessonSlug"), and
// the index read is memoized per (lessonSlug, variantKey). Grant minting is
// NEVER memoized: every launch item gets its own assignment-bound grant. A
// single deep-link launch creates one resolver and calls `resolve` once; the
// student assignment list creates one resolver and calls `resolve` per item,
// so a list of N items for one accommodated student performs one accommodation
// read, one flag read, one index read per distinct lessonSlug, and up to N
// grant mints.
export function createLaunchPresentationResolver(
  ports: LaunchPresentationResolverPorts,
): LaunchPresentationResolver {
  const readingCache = new Map<string, Promise<ReadingResolution>>();
  let deliveryEnabledPromise: Promise<boolean> | undefined;
  const indexCache = new Map<string, Promise<VariantIndexEvaluation>>();

  function cachedReadReading(studentId: string): Promise<ReadingResolution> {
    let cached = readingCache.get(studentId);
    if (!cached) {
      cached = ports.readReading(studentId);
      readingCache.set(studentId, cached);
    }
    return cached;
  }

  function cachedIsDeliveryEnabled(): Promise<boolean> {
    if (!deliveryEnabledPromise) {
      deliveryEnabledPromise = ports.isDeliveryEnabled();
    }
    return deliveryEnabledPromise;
  }

  function cachedReadVariantIndex(
    lessonSlug: string,
    variantKey: string,
  ): Promise<VariantIndexEvaluation> {
    const key = `${lessonSlug}__${variantKey}`;
    let cached = indexCache.get(key);
    if (!cached) {
      cached = ports.readVariantIndex(lessonSlug, variantKey);
      indexCache.set(key, cached);
    }
    return cached;
  }

  async function resolve(
    input: ResolveLaunchPresentationInput,
  ): Promise<LaunchPresentationResolution> {
    const { studentId, assignmentId, lessonSlug } = input;
    try {
      const reading = await cachedReadReading(studentId);
      // Rows 1-2: absent or inactive accommodation -> EXPECTED_CANONICAL.
      // No grant, no presentation. Response stays shape-identical to
      // pre-feature behavior for the canonical population.
      if (!reading.active) {
        return { kind: "expectedCanonical" };
      }

      const variantKey = ports.variantKeyForReadingLevel(reading.level);

      // Row 14 (§8.6): operational disable. A covered active accommodation
      // legitimately reaches canonical delivery here; mint ONLY a
      // canonicalFallback grant, never a differentiated one, before even
      // consulting the index. The accommodation record is untouched.
      const deliveryEnabled = await cachedIsDeliveryEnabled();
      if (!deliveryEnabled) {
        const launchRef = await ports.mintGrant({
          outcomeAtIssuance: "canonicalFallback",
          studentId,
          assignmentId,
          lessonSlug,
        });
        ports.telemetry({
          type: "operationalDisable",
          studentId,
          assignmentId,
          lessonSlug,
          variantKey,
        });
        return { kind: "canonicalFallback", launchRef, reason: "operationalDisable" };
      }

      const index = await cachedReadVariantIndex(lessonSlug, variantKey);

      if (index.kind === "active") {
        // Row G: valid active coverage + delivery enabled -> differentiated.
        // The grant binds the index's CURRENT pair; once minted it is
        // immutable evidence of exactly this revision (the A->B invariant is a
        // property of the immutable grant, never re-resolved).
        const launchRef = await ports.mintGrant({
          outcomeAtIssuance: "differentiated",
          studentId,
          assignmentId,
          lessonSlug,
          variantKey: index.variantKey,
          presentationRevisionId: index.presentationRevisionId,
        });
        ports.telemetry({
          type: "differentiatedResolved",
          studentId,
          assignmentId,
          lessonSlug,
          variantKey: index.variantKey,
          presentationRevisionId: index.presentationRevisionId,
        });
        return {
          kind: "differentiated",
          launchRef,
          presentation: {
            variantKey: index.variantKey,
            presentationRevisionId: index.presentationRevisionId,
            path: index.path,
          },
        };
      }

      // Rows 3-5: a legitimate coverage gap (absent), a coverage withdrawal
      // (retired), or a defect-driven malformed index. ALL mint a
      // canonicalFallback grant at the resolver (§4 Op C) so the launch still
      // carries truthful fallback evidence; the malformed case additionally
      // raises a defect-severity anomaly. None returns a presentation pair.
      const reason: LaunchFallbackReason =
        index.kind === "absent"
          ? "coverageAbsent"
          : index.kind === "retired"
            ? "coverageRetired"
            : "coverageMalformed";
      const launchRef = await ports.mintGrant({
        outcomeAtIssuance: "canonicalFallback",
        studentId,
        assignmentId,
        lessonSlug,
      });
      ports.telemetry({
        type: reason,
        studentId,
        assignmentId,
        lessonSlug,
        variantKey,
      });
      return { kind: "canonicalFallback", launchRef, reason };
    } catch (err) {
      // Row 8: internal resolver/storage/grant-mint failure -> canonical
      // response, telemetry, NO grant. Never a false differentiated claim and
      // never a refusal at the resolver.
      const message = err instanceof Error ? err.message : String(err);
      ports.telemetry({
        type: "internalFailure",
        studentId,
        assignmentId,
        lessonSlug,
        error: message,
      });
      return { kind: "internalFailure" };
    }
  }

  return { resolve };
}
