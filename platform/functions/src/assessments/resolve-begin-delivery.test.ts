import { PlatformError } from "../shared/errors/platform-error";
import type { ReadingResolution } from "../shared/presentation/resolve-launch-presentation";

import {
  resolveBeginDelivery,
  type BeginCoverageKind,
  type BeginDeliveryPorts,
  type BeginDeliveryTelemetryEvent,
  type RawLaunchGrant,
} from "./resolve-begin-delivery";

// F5.2 §8 (C1/C5, P1/P2) - Persistent Student Differentiation Slice 6.
// Exhaustive behavioral coverage of the PURE begin-time delivery-freeze
// decision core with injected fakes. Suites N (launch binding), O (delivery
// outcome), and R (no-ref coverage + operational disable) plus the tamper and
// A->B invariants live here; the begin handler test proves the wiring and that
// a refused begin creates no session/attempt.

const STUDENT = "student-uid";
const ASSIGNMENT = "assign-1";
const LESSON = "earths-layers"; // charset-valid so coverage can be "active"
const VARIANT_KEY = "reading-adapted";
const REVISION_A = `pr${"a".repeat(64)}`;
const REVISION_B = `pr${"b".repeat(64)}`;
const VALID_GRANT_ID = "0123456789abcdef0123456789abcdef";
const NOW_MS = 1_700_000_000_000;

type PortOverrides = {
  grant?: RawLaunchGrant | undefined;
  readGrantThrows?: boolean;
  reading?: ReadingResolution;
  readAccommodationThrows?: boolean;
  enabled?: boolean;
  coverage?: BeginCoverageKind;
  readCoverageThrows?: boolean;
  isValidGrantId?: (value: unknown) => boolean;
  nowMs?: number;
};

type Harness = {
  ports: BeginDeliveryPorts;
  events: BeginDeliveryTelemetryEvent[];
  calls: {
    readGrant: string[];
    readAccommodation: number;
    isDeliveryEnabled: number;
    readCoverage: Array<{ lessonSlug: string; variantKey: string }>;
  };
};

function makeHarness(overrides: PortOverrides = {}): Harness {
  const events: BeginDeliveryTelemetryEvent[] = [];
  const calls = {
    readGrant: [] as string[],
    readAccommodation: 0,
    isDeliveryEnabled: 0,
    readCoverage: [] as Array<{ lessonSlug: string; variantKey: string }>,
  };
  const ports: BeginDeliveryPorts = {
    readGrant: (grantId) => {
      calls.readGrant.push(grantId);
      if (overrides.readGrantThrows) {
        return Promise.reject(new Error("grant read failed"));
      }
      return Promise.resolve(overrides.grant);
    },
    readAccommodation: () => {
      calls.readAccommodation += 1;
      if (overrides.readAccommodationThrows) {
        return Promise.reject(new Error("accommodation read failed"));
      }
      return Promise.resolve(overrides.reading ?? { active: false });
    },
    isDeliveryEnabled: () => {
      calls.isDeliveryEnabled += 1;
      return Promise.resolve(overrides.enabled ?? true);
    },
    readCoverage: (lessonSlug, variantKey) => {
      calls.readCoverage.push({ lessonSlug, variantKey });
      if (overrides.readCoverageThrows) {
        return Promise.reject(new Error("coverage read failed"));
      }
      return Promise.resolve(overrides.coverage ?? "absent");
    },
    variantKeyForReadingLevel: (level) => `reading-${level}`,
    isValidGrantId:
      overrides.isValidGrantId ??
      ((value): boolean => typeof value === "string" && /^[0-9a-f]{32}$/.test(value)),
    telemetry: (event) => events.push(event),
    nowMs: () => overrides.nowMs ?? NOW_MS,
  };
  return { ports, events, calls };
}

function differentiatedGrant(
  overrides: Partial<RawLaunchGrant> = {},
): RawLaunchGrant {
  return {
    studentId: STUDENT,
    assignmentId: ASSIGNMENT,
    lessonSlug: LESSON,
    outcomeAtIssuance: "differentiated",
    variantKey: VARIANT_KEY,
    presentationRevisionId: REVISION_A,
    expiresAt: { toMillis: () => NOW_MS + 60_000 },
    ...overrides,
  };
}

function fallbackGrant(overrides: Partial<RawLaunchGrant> = {}): RawLaunchGrant {
  return {
    studentId: STUDENT,
    assignmentId: ASSIGNMENT,
    lessonSlug: LESSON,
    outcomeAtIssuance: "canonicalFallback",
    expiresAt: { toMillis: () => NOW_MS + 60_000 },
    ...overrides,
  };
}

const baseInput = {
  studentId: STUDENT,
  assignmentId: ASSIGNMENT,
  lessonSlug: LESSON,
};

async function expectCode(promise: Promise<unknown>, code: string): Promise<PlatformError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(PlatformError);
    expect((err as PlatformError).code).toBe(code);
    return err as PlatformError;
  }
  throw new Error(`expected rejection with code ${code}`);
}

describe("resolveBeginDelivery - valid grant path (suite N/O)", () => {
  it("freezes differentiated with the grant's exact pair", async () => {
    const h = makeHarness({ grant: differentiatedGrant() });
    const freeze = await resolveBeginDelivery(h.ports, {
      ...baseInput,
      launchRef: VALID_GRANT_ID,
    });
    expect(freeze).toEqual({
      deliveryOutcome: "differentiated",
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_A,
    });
  });

  it("T-N1: freezes revision A from the grant even though the index now points at B", async () => {
    // The grant validly bound A. Coverage/index is intentionally set to
    // "active" pointing (conceptually) at B; the grant path NEVER reads the
    // index, so A is frozen and B is never consulted.
    const h = makeHarness({
      grant: differentiatedGrant({ presentationRevisionId: REVISION_A }),
      coverage: "active",
    });
    const freeze = await resolveBeginDelivery(h.ports, {
      ...baseInput,
      launchRef: VALID_GRANT_ID,
    });
    expect(freeze).toEqual({
      deliveryOutcome: "differentiated",
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_A,
    });
    expect(freeze).not.toEqual(
      expect.objectContaining({ presentationRevisionId: REVISION_B }),
    );
    expect(h.calls.readCoverage).toHaveLength(0);
    expect(h.calls.readAccommodation).toBe(0);
  });

  it("T-N2: freezes differentiated even if the accommodation was deactivated after issuance", async () => {
    // The grant path never reads the accommodation record: delivered truth is
    // recorded, deactivation governs only later launches.
    const h = makeHarness({
      grant: differentiatedGrant(),
      reading: { active: false },
    });
    const freeze = await resolveBeginDelivery(h.ports, {
      ...baseInput,
      launchRef: VALID_GRANT_ID,
    });
    expect(freeze).toEqual({
      deliveryOutcome: "differentiated",
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_A,
    });
    expect(h.calls.readAccommodation).toBe(0);
  });

  it("freezes canonicalFallback (no pair) from a valid fallback grant", async () => {
    const h = makeHarness({ grant: fallbackGrant() });
    const freeze = await resolveBeginDelivery(h.ports, {
      ...baseInput,
      launchRef: VALID_GRANT_ID,
    });
    expect(freeze).toEqual({ deliveryOutcome: "canonicalFallback" });
  });

  it("keeps a fallback grant as canonicalFallback even when coverage now exists", async () => {
    // Issuance-time fallback truth is preserved; the grant path never
    // reclassifies to differentiated because coverage became available later.
    const h = makeHarness({ grant: fallbackGrant(), coverage: "active" });
    const freeze = await resolveBeginDelivery(h.ports, {
      ...baseInput,
      launchRef: VALID_GRANT_ID,
    });
    expect(freeze).toEqual({ deliveryOutcome: "canonicalFallback" });
    expect(h.calls.readCoverage).toHaveLength(0);
  });
});

describe("resolveBeginDelivery - invalid grant path (suite N, negative)", () => {
  it("T-N3: refuses an unknown grant with LAUNCH_REF_INVALID and no freeze", async () => {
    const h = makeHarness({ grant: undefined });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
  });

  it("refuses a malformed grant id without reading the grant", async () => {
    const h = makeHarness({ isValidGrantId: () => false });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: "not-hex" }),
      "LAUNCH_REF_INVALID",
    );
    expect(h.calls.readGrant).toHaveLength(0);
  });

  it("T-N4: refuses another student's grant with the byte-identical shape", async () => {
    const h = makeHarness({ grant: differentiatedGrant({ studentId: "other-uid" }) });
    const err = await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
    // Byte-identical to the unknown-grant refusal (no existence disclosure).
    const unknown = makeHarness({ grant: undefined });
    const err2 = await expectCode(
      resolveBeginDelivery(unknown.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
    expect(err.message).toBe(err2.message);
  });

  it("T-N5: refuses a grant for another assignment", async () => {
    const h = makeHarness({ grant: differentiatedGrant({ assignmentId: "other-assign" }) });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
  });

  it("refuses a grant for another lesson", async () => {
    const h = makeHarness({ grant: differentiatedGrant({ lessonSlug: "other-lesson" }) });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
  });

  it("T-N6: refuses an expired grant with the retriable LAUNCH_REF_EXPIRED", async () => {
    const h = makeHarness({
      grant: differentiatedGrant({ expiresAt: { toMillis: () => NOW_MS - 1 } }),
    });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_EXPIRED",
    );
  });

  it("treats a grant whose expiry equals now as expired", async () => {
    const h = makeHarness({
      grant: differentiatedGrant({ expiresAt: { toMillis: () => NOW_MS } }),
    });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_EXPIRED",
    );
  });

  it("refuses a grant with a missing/malformed expiresAt as invalid (not expired)", async () => {
    const h = makeHarness({ grant: differentiatedGrant({ expiresAt: undefined }) });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
  });

  it("refuses a differentiated grant missing its pair (malformed record)", async () => {
    const h = makeHarness({
      grant: differentiatedGrant({ presentationRevisionId: undefined }),
    });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
  });

  it("refuses a canonicalFallback grant carrying a presentation pair (malformed record)", async () => {
    const h = makeHarness({
      grant: fallbackGrant({ variantKey: VARIANT_KEY, presentationRevisionId: REVISION_A }),
    });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
  });

  it("refuses a grant with an invalid outcomeAtIssuance", async () => {
    const h = makeHarness({
      grant: differentiatedGrant({ outcomeAtIssuance: "canonical" }),
    });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "LAUNCH_REF_INVALID",
    );
  });

  it("T-N7: converts a transient grant-read failure to BEGIN_VALIDATION_UNAVAILABLE", async () => {
    const h = makeHarness({ readGrantThrows: true });
    await expectCode(
      resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }),
      "BEGIN_VALIDATION_UNAVAILABLE",
    );
  });
});

describe("resolveBeginDelivery - no-launchRef decision table (suite R/O, P1)", () => {
  it("T-O2: no accommodation record -> canonical, no pair, no flag/coverage read", async () => {
    const h = makeHarness({ reading: { active: false } });
    const freeze = await resolveBeginDelivery(h.ports, baseInput);
    expect(freeze).toEqual({ deliveryOutcome: "canonical" });
    expect(h.calls.isDeliveryEnabled).toBe(0);
    expect(h.calls.readCoverage).toHaveLength(0);
  });

  it("inactive accommodation -> canonical", async () => {
    const h = makeHarness({ reading: { active: false } });
    const freeze = await resolveBeginDelivery(h.ports, baseInput);
    expect(freeze).toEqual({ deliveryOutcome: "canonical" });
  });

  it("T-R4: active + operational disabled -> canonicalFallback, no pair, index NOT read", async () => {
    const h = makeHarness({
      reading: { active: true, level: "adapted" },
      enabled: false,
      coverage: "active",
    });
    const freeze = await resolveBeginDelivery(h.ports, baseInput);
    expect(freeze).toEqual({ deliveryOutcome: "canonicalFallback" });
    // The disable overrides coverage: the index is never consulted, and the
    // accommodation record is never written (no write port exists).
    expect(h.calls.readCoverage).toHaveLength(0);
  });

  it("T-R2: active + enabled + coverage absent -> canonicalFallback", async () => {
    const h = makeHarness({
      reading: { active: true, level: "adapted" },
      enabled: true,
      coverage: "absent",
    });
    const freeze = await resolveBeginDelivery(h.ports, baseInput);
    expect(freeze).toEqual({ deliveryOutcome: "canonicalFallback" });
  });

  it("T-R2: active + enabled + coverage retired -> canonicalFallback", async () => {
    const h = makeHarness({
      reading: { active: true, level: "adapted" },
      enabled: true,
      coverage: "retired",
    });
    const freeze = await resolveBeginDelivery(h.ports, baseInput);
    expect(freeze).toEqual({ deliveryOutcome: "canonicalFallback" });
  });

  it("T-R1/T-N9: active + enabled + coverage active + no ref -> BEGIN_REQUIRES_LAUNCH, no freeze", async () => {
    const h = makeHarness({
      reading: { active: true, level: "adapted" },
      enabled: true,
      coverage: "active",
    });
    await expectCode(
      resolveBeginDelivery(h.ports, baseInput),
      "BEGIN_REQUIRES_LAUNCH",
    );
  });

  it("active + enabled + coverage malformed -> BEGIN_VALIDATION_UNAVAILABLE", async () => {
    const h = makeHarness({
      reading: { active: true, level: "adapted" },
      enabled: true,
      coverage: "malformed",
    });
    await expectCode(
      resolveBeginDelivery(h.ports, baseInput),
      "BEGIN_VALIDATION_UNAVAILABLE",
    );
  });

  it("converts a transient accommodation-read failure to BEGIN_VALIDATION_UNAVAILABLE", async () => {
    const h = makeHarness({ readAccommodationThrows: true });
    await expectCode(
      resolveBeginDelivery(h.ports, baseInput),
      "BEGIN_VALIDATION_UNAVAILABLE",
    );
  });

  it("converts a transient coverage-read failure to BEGIN_VALIDATION_UNAVAILABLE", async () => {
    const h = makeHarness({
      reading: { active: true, level: "adapted" },
      enabled: true,
      readCoverageThrows: true,
    });
    await expectCode(
      resolveBeginDelivery(h.ports, baseInput),
      "BEGIN_VALIDATION_UNAVAILABLE",
    );
  });
});

describe("resolveBeginDelivery - telemetry never carries the launchRef token", () => {
  it("emits operational telemetry with no launchRef field on any event", async () => {
    // Drive several branches and assert the opaque token never appears.
    const cases: Array<() => Promise<unknown>> = [
      () => {
        const h = makeHarness({ grant: differentiatedGrant() });
        return resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID }).then(
          () => h.events,
        );
      },
      () => {
        const h = makeHarness({ grant: undefined });
        return resolveBeginDelivery(h.ports, { ...baseInput, launchRef: VALID_GRANT_ID })
          .catch(() => undefined)
          .then(() => h.events);
      },
      () => {
        const h = makeHarness({ reading: { active: true, level: "adapted" }, coverage: "active" });
        return resolveBeginDelivery(h.ports, baseInput)
          .catch(() => undefined)
          .then(() => h.events);
      },
    ];
    for (const run of cases) {
      const events = (await run()) as BeginDeliveryTelemetryEvent[];
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        const serialized = JSON.stringify(event);
        expect(serialized).not.toContain(VALID_GRANT_ID);
        expect(serialized).not.toContain("launchRef");
      }
    }
  });
});
