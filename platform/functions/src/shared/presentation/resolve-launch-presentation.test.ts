import {
  createLaunchPresentationResolver,
  type LaunchPresentationResolverPorts,
  type ReadingResolution,
  type VariantIndexEvaluation,
} from "./resolve-launch-presentation";

// F5.2 §4 Op C / §8.5 / §8.6 - decision-table and grant-minting unit tests for
// the pure launch-presentation resolver core (Persistent Student
// Differentiation Slice 4). Every side effect is a fake port, so these tests
// exercise the exact decision table without Firestore, crypto, or config.
//
// Covered: F5.2 suite C (resolution decision table), the resolver half of
// suite R (P2 operational disable at resolve), grant-mint pairing assertions,
// the A->B binding invariant at issuance, memoized read counts (§7.3), and the
// internal-failure canonical degradation (§8.5 row 8).

const STUDENT_ID = "student-uid";
const ASSIGNMENT_ID = "assign-1";
const LESSON_SLUG = "earths-layers";
const VARIANT_KEY = "reading-adapted";
const REVISION_A = `pr${"a".repeat(64)}`;
const REVISION_B = `pr${"b".repeat(64)}`;
const PATH_A = `app/lessons/variants/lesson_${LESSON_SLUG}__${REVISION_A}.html`;

type PortOverrides = Partial<LaunchPresentationResolverPorts>;

const activeReading: ReadingResolution = { active: true, level: "adapted" };
const activeIndex: VariantIndexEvaluation = {
  kind: "active",
  variantKey: VARIANT_KEY,
  presentationRevisionId: REVISION_A,
  path: PATH_A,
};

function makePorts(overrides: PortOverrides = {}): {
  ports: LaunchPresentationResolverPorts;
  mintGrant: jest.Mock;
  telemetry: jest.Mock;
  readReading: jest.Mock;
  isDeliveryEnabled: jest.Mock;
  readVariantIndex: jest.Mock;
} {
  let grantSeq = 0;
  const mintGrant = jest.fn(() =>
    Promise.resolve(`grant-${(grantSeq += 1).toString()}`),
  );
  const telemetry = jest.fn(() => undefined);
  const readReading = jest.fn(() => Promise.resolve(activeReading));
  const isDeliveryEnabled = jest.fn(() => Promise.resolve(true));
  const readVariantIndex = jest.fn(() => Promise.resolve(activeIndex));

  const ports: LaunchPresentationResolverPorts = {
    readReading: overrides.readReading ?? readReading,
    isDeliveryEnabled: overrides.isDeliveryEnabled ?? isDeliveryEnabled,
    readVariantIndex: overrides.readVariantIndex ?? readVariantIndex,
    mintGrant: overrides.mintGrant ?? mintGrant,
    telemetry: overrides.telemetry ?? telemetry,
    variantKeyForReadingLevel:
      overrides.variantKeyForReadingLevel ?? ((level) => `reading-${level}`),
  };
  return {
    ports,
    mintGrant: (ports.mintGrant as jest.Mock),
    telemetry: (ports.telemetry as jest.Mock),
    readReading: (ports.readReading as jest.Mock),
    isDeliveryEnabled: (ports.isDeliveryEnabled as jest.Mock),
    readVariantIndex: (ports.readVariantIndex as jest.Mock),
  };
}

const INPUT = {
  studentId: STUDENT_ID,
  assignmentId: ASSIGNMENT_ID,
  lessonSlug: LESSON_SLUG,
};

describe("resolve-launch-presentation - decision table (suite C)", () => {
  it("EXPECTED_CANONICAL when there is no active accommodation (no grant, no read)", async () => {
    const h = makePorts({
      readReading: jest.fn((): Promise<ReadingResolution> => Promise.resolve({ active: false })),
    });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toEqual({ kind: "expectedCanonical" });
    expect(h.mintGrant).not.toHaveBeenCalled();
    expect(h.telemetry).not.toHaveBeenCalled();
    // No index or flag read for a canonical-expected student.
    expect(h.readVariantIndex).not.toHaveBeenCalled();
  });

  it("differentiated when active + enabled + active valid coverage", async () => {
    const h = makePorts();
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toEqual({
      kind: "differentiated",
      launchRef: "grant-1",
      presentation: {
        variantKey: VARIANT_KEY,
        presentationRevisionId: REVISION_A,
        path: PATH_A,
      },
    });
    // The grant binds the exact resolved pair.
    expect(h.mintGrant).toHaveBeenCalledWith({
      outcomeAtIssuance: "differentiated",
      studentId: STUDENT_ID,
      assignmentId: ASSIGNMENT_ID,
      lessonSlug: LESSON_SLUG,
      variantKey: VARIANT_KEY,
      presentationRevisionId: REVISION_A,
    });
    expect(h.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: "differentiatedResolved" }),
    );
  });

  it("canonicalFallback (coverageAbsent) when index absent", async () => {
    const h = makePorts({
      readVariantIndex: jest.fn((): Promise<VariantIndexEvaluation> => Promise.resolve({ kind: "absent" })),
    });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toEqual({
      kind: "canonicalFallback",
      launchRef: "grant-1",
      reason: "coverageAbsent",
    });
    expect(h.mintGrant).toHaveBeenCalledWith({
      outcomeAtIssuance: "canonicalFallback",
      studentId: STUDENT_ID,
      assignmentId: ASSIGNMENT_ID,
      lessonSlug: LESSON_SLUG,
    });
    // A fallback grant carries NO presentation pair.
    expect(h.mintGrant.mock.calls[0][0]).not.toHaveProperty("variantKey");
    expect(h.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: "coverageAbsent" }),
    );
  });

  it("canonicalFallback (coverageRetired) when index retired", async () => {
    const h = makePorts({
      readVariantIndex: jest.fn((): Promise<VariantIndexEvaluation> => Promise.resolve({ kind: "retired" })),
    });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toMatchObject({ kind: "canonicalFallback", reason: "coverageRetired" });
    expect(h.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: "coverageRetired" }),
    );
  });

  it("canonicalFallback (coverageMalformed) + defect anomaly when index malformed", async () => {
    const h = makePorts({
      readVariantIndex: jest.fn((): Promise<VariantIndexEvaluation> => Promise.resolve({ kind: "malformed" })),
    });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toMatchObject({ kind: "canonicalFallback", reason: "coverageMalformed" });
    // Never a fake pair; never differentiated for a malformed index.
    expect(h.mintGrant.mock.calls[0][0].outcomeAtIssuance).toBe("canonicalFallback");
    expect(h.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: "coverageMalformed" }),
    );
  });

  it("internalFailure (canonical, no grant) when a read throws", async () => {
    const h = makePorts({
      readVariantIndex: jest.fn(
        (): Promise<VariantIndexEvaluation> =>
          Promise.reject(new Error("firestore down")),
      ),
    });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toEqual({ kind: "internalFailure" });
    expect(h.mintGrant).not.toHaveBeenCalled();
    expect(h.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: "internalFailure" }),
    );
  });

  it("internalFailure (canonical, no grant) when grant minting throws", async () => {
    const h = makePorts({
      mintGrant: jest.fn(
        (): Promise<string> => Promise.reject(new Error("grant write failed")),
      ),
    });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toEqual({ kind: "internalFailure" });
  });
});

describe("resolve-launch-presentation - operational disable (suite R, P2 at resolve)", () => {
  it("T-R4/row14: active + disabled -> canonicalFallback, no pair, never differentiated, no index read", async () => {
    const h = makePorts({ isDeliveryEnabled: jest.fn(() => Promise.resolve(false)) });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    expect(res).toMatchObject({ kind: "canonicalFallback", reason: "operationalDisable" });
    expect(h.mintGrant.mock.calls[0][0].outcomeAtIssuance).toBe("canonicalFallback");
    expect(h.mintGrant.mock.calls[0][0]).not.toHaveProperty("presentationRevisionId");
    // Disable short-circuits BEFORE the index read: the platform does not even
    // consult coverage while delivery is off.
    expect(h.readVariantIndex).not.toHaveBeenCalled();
    expect(h.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ type: "operationalDisable" }),
    );
  });

  it("fail-closed: active + valid coverage but delivery-flag read fails -> NOT differentiated (internalFailure, no grant)", async () => {
    const h = makePorts({
      isDeliveryEnabled: jest.fn(
        (): Promise<boolean> => Promise.reject(new Error("flag read failed")),
      ),
    });
    const res = await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    // Inability to prove the flag is explicitly enabled never authorizes
    // differentiated delivery: the resolver degrades to canonical, no grant.
    expect(res).toEqual({ kind: "internalFailure" });
    expect(h.mintGrant).not.toHaveBeenCalled();
    expect(h.readVariantIndex).not.toHaveBeenCalled();
  });

  it("re-enable: the SAME active accommodation resumes differentiated once the flag flips true, with no accommodation mutation", async () => {
    // Disabled run: same active reading + active coverage -> canonicalFallback.
    const disabled = makePorts({ isDeliveryEnabled: jest.fn(() => Promise.resolve(false)) });
    const first = await createLaunchPresentationResolver(disabled.ports).resolve(INPUT);
    expect(first).toMatchObject({ kind: "canonicalFallback", reason: "operationalDisable" });

    // Operator flips the flag to true. Same accommodation state (the resolver
    // reads it, never writes it) now yields differentiated delivery.
    const enabled = makePorts({ isDeliveryEnabled: jest.fn(() => Promise.resolve(true)) });
    const second = await createLaunchPresentationResolver(enabled.ports).resolve(INPUT);
    expect(second).toMatchObject({ kind: "differentiated" });
    // The resolver never mutates accommodation state - it only ever reads it.
    // (No mintGrant/index/write path touches the accommodation record.)
    expect(enabled.readReading).toHaveBeenCalledTimes(1);
  });
});

describe("resolve-launch-presentation - A->B binding invariant at issuance", () => {
  it("binds the grant to the index's CURRENT pair (A) and never re-resolves", async () => {
    // Index currently points at revision A. The mint must receive exactly A.
    const h = makePorts();
    await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    const minted = h.mintGrant.mock.calls[0][0];
    expect(minted).toMatchObject({
      outcomeAtIssuance: "differentiated",
      presentationRevisionId: REVISION_A,
    });
    // The resolver never reads B; it only ever binds what the index reported
    // at resolve time. (Immutability of the STORED grant once B becomes current
    // is a property of the write layer / grant record, asserted in the
    // launch-grant type tests.)
    expect(minted.presentationRevisionId).not.toBe(REVISION_B);
  });
});

describe("resolve-launch-presentation - per-request memoization (§7.3)", () => {
  it("reads accommodation once, flag once, and index once per lesson across N items", async () => {
    const h = makePorts();
    const resolver = createLaunchPresentationResolver(h.ports);
    // Two list items, same lessonSlug, different assignmentIds.
    await resolver.resolve({ ...INPUT, assignmentId: "a1" });
    await resolver.resolve({ ...INPUT, assignmentId: "a2" });
    expect(h.readReading).toHaveBeenCalledTimes(1);
    expect(h.isDeliveryEnabled).toHaveBeenCalledTimes(1);
    expect(h.readVariantIndex).toHaveBeenCalledTimes(1);
    // But a distinct grant is minted per item (assignment-bound).
    expect(h.mintGrant).toHaveBeenCalledTimes(2);
    expect(h.mintGrant.mock.calls[0][0].assignmentId).toBe("a1");
    expect(h.mintGrant.mock.calls[1][0].assignmentId).toBe("a2");
  });

  it("reads the index once per DISTINCT lesson", async () => {
    const h = makePorts();
    const resolver = createLaunchPresentationResolver(h.ports);
    await resolver.resolve({ ...INPUT, lessonSlug: "lesson-one" });
    await resolver.resolve({ ...INPUT, lessonSlug: "lesson-two" });
    await resolver.resolve({ ...INPUT, lessonSlug: "lesson-one" });
    expect(h.readVariantIndex).toHaveBeenCalledTimes(2);
  });
});

describe("resolve-launch-presentation - server-authoritative identity", () => {
  it("derives variantKey from the trusted level, never from the caller", async () => {
    const variantKeyForReadingLevel = jest.fn((level: string) => `reading-${level}`);
    const h = makePorts({ variantKeyForReadingLevel });
    await createLaunchPresentationResolver(h.ports).resolve(INPUT);
    // The index is read with the SERVER-derived variantKey.
    expect(variantKeyForReadingLevel).toHaveBeenCalledWith("adapted");
    expect(h.readVariantIndex).toHaveBeenCalledWith(LESSON_SLUG, VARIANT_KEY);
  });
});
