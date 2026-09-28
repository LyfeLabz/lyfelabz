import * as crypto from "crypto";

import {
  planScopedCoverageWrite,
  publishRetainedRevision,
  retireVariant,
  type FetchHostedPort,
  type PublishInput,
  type RetainedRevision,
  type WriteScopedCoveragePort,
} from "./variant-publication";

// F5.2 §6.8 publication state machine (Slice 3). These tests exercise the
// pure machine with in-memory fakes for every port - no Hosting, no
// Firestore, no network. They prove the index-last ordering and fail-closed
// behavior (suite P, T-E2/E4-index, ordering/failure-safety/retry/rollback/
// retirement/concurrency per the Slice 3 test contract).

const LESSON = "earths-layers";
const VARIANT = "reading-adapted";
const OPERATOR = "operator-uid";
// F5.3 Slice 9C-2: every retained revision covers an assessment revision; the
// state machine writes only the scoped document for it.
const R1 = `assessment_${LESSON}__r1`;

function sha256(bytes: string | Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const hashBytes = (bytes: string | Buffer | Uint8Array): string =>
  crypto.createHash("sha256").update(bytes as crypto.BinaryLike).digest("hex");

type ManifestEntry = {
  lessonSlug: string;
  variantKey: string;
  presentationRevisionId: string;
  path: string;
  sha256: string;
  assessmentRevisionId: string;
};

type IndexRecord = {
  lessonSlug: string;
  variantKey: string;
  currentPresentationRevisionId: string;
  currentPath: string;
  contentSha256: string;
  status: "active" | "retired";
  assessmentRevisionId: string;
  assessmentPresentationRevisionId?: string;
  publishedBy: string;
};

// A fake world: an append-only manifest ledger, the committed tree, the
// deployed (hosted) tree, and the mutable Firestore index. `events` records
// side effects in order so ordering can be asserted.
function makeWorld() {
  const manifest: ManifestEntry[] = [];
  const tree = new Map<string, string>();
  const hosted = new Map<string, string>();
  const index = new Map<string, IndexRecord>();
  const events: string[] = [];
  const deployed = new Set<string>([R1]);
  let verifierOk = true;

  // The revision-scoped document id (F5.3 Slice 9C-2).
  function docId(lessonSlug: string, variantKey: string, ordinal = 1): string {
    return `${lessonSlug}__${variantKey}__r${String(ordinal)}`;
  }

  // Simulates the Slice 2 add-only build: retain immutable bytes + append the
  // manifest entry. Idempotent for identical bytes; never rewrites history.
  function retain(lessonSlug: string, variantKey: string, bytes: string, assessmentRevisionId = R1): ManifestEntry {
    const digest = sha256(bytes);
    const id = `pr${digest}`;
    const p = `app/lessons/variants/lesson_${lessonSlug}__${id}.html`;
    tree.set(p, bytes);
    const entry = { lessonSlug, variantKey, presentationRevisionId: id, path: p, sha256: digest, assessmentRevisionId };
    if (!manifest.find((e) => e.path === p)) manifest.push(entry);
    return entry;
  }

  // Simulates `firebase deploy` publishing the committed tree to Hosting.
  function deployToHosted(): void {
    for (const [p, b] of tree.entries()) hosted.set(p, b);
  }

  const loadRetainedRevision = ({
    lessonSlug,
    variantKey,
    presentationRevisionId,
  }: {
    lessonSlug: string;
    variantKey: string;
    presentationRevisionId: string;
  }) => {
    events.push("load");
    if (!verifierOk) {
      return Promise.resolve({ ok: false as const, error: "retention verifier failed; refusing to publish" });
    }
    const m = manifest.find(
      (e) =>
        e.lessonSlug === lessonSlug &&
        e.variantKey === variantKey &&
        e.presentationRevisionId === presentationRevisionId,
    );
    if (!m) return Promise.resolve({ ok: false as const, error: `no retained revision ${presentationRevisionId}` });
    const onDisk = tree.get(m.path);
    if (onDisk === undefined) return Promise.resolve({ ok: false as const, error: `artifact missing: ${m.path}` });
    if (sha256(onDisk) !== m.sha256) return Promise.resolve({ ok: false as const, error: `artifact altered: ${m.path}` });
    return Promise.resolve({
      ok: true as const,
      revision: { ...m, assessmentRevisionSource: "declared" } satisfies RetainedRevision,
    });
  };

  // The scoped write port, mirroring the real transactional port: re-read and
  // decide with the shared planner, then create, do nothing, or repoint.
  const writeScopedCoverage: WriteScopedCoveragePort = ({ key, record, publishedBy, mode }) => {
    events.push("write");
    const plan = planScopedCoverageWrite(index.get(key.docId), record, mode);
    if (plan.ok && plan.action !== "reconcile") index.set(key.docId, { ...record, publishedBy });
    return Promise.resolve(plan);
  };

  return {
    manifest,
    tree,
    hosted,
    index,
    events,
    docId,
    retain,
    deployToHosted,
    setVerifierOk: (v: boolean) => {
      verifierOk = v;
    },
    deployed,
    ports: {
      loadRetainedRevision,
      writeScopedCoverage,
      readScopedCoverage: (key: { docId: string }) => {
        const rec = index.get(key.docId);
        return Promise.resolve(rec === undefined ? { exists: false as const } : { exists: true as const, data: rec });
      },
      isAssessmentRevisionDeployed: (id: string) => Promise.resolve(deployed.has(id)),
      hashBytes,
    },
  };
}

// A liveness fetch that serves the world's HOSTED tree exactly, with a
// non-redirect 200. Distinct helpers below simulate specific failure modes.
function makeHostedFetch(world: ReturnType<typeof makeWorld>): FetchHostedPort {
  return (relPath) => {
    world.events.push("fetch");
    const bytes = world.hosted.get(relPath);
    if (bytes === undefined) {
      return Promise.resolve({ ok: true, status: 404, redirected: false, bytes: "" });
    }
    return Promise.resolve({ ok: true, status: 200, redirected: false, bytes });
  };
}

function baseInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    lessonSlug: LESSON,
    variantKey: VARIANT,
    presentationRevisionId: overrides.presentationRevisionId ?? `pr${"a".repeat(64)}`,
    publishedBy: OPERATOR,
    mode: "publish",
    ...overrides,
  };
}

describe("publication state machine ordering (§6.8)", () => {
  test("runs LOCAL -> DEPLOY -> FETCH(liveness) -> INDEX in that exact order, index last", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.events.push("deploy");
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });

    expect(result.ok).toBe(true);
    // Local verification before deploy; deploy before hosted fetch; hosted
    // verification before the index write; index write last.
    expect(world.events).toEqual(["load", "deploy", "fetch", "write"]);
    if (result.ok) {
      expect(result.stagesCompleted).toEqual([
        "LOCAL_VERIFIED",
        "HOSTING_DEPLOYED",
        "HOSTED_BYTES_VERIFIED",
        "INDEX_UPDATED",
      ]);
    }
  });
});

describe("successful publication writes a self-consistent index from trusted manifest values", () => {
  test("index fields match the trusted retained revision and carry server-owned attribution", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });

    expect(result.ok).toBe(true);
    const rec = world.index.get(world.docId(LESSON, VARIANT));
    expect(rec).toEqual({
      lessonSlug: LESSON,
      variantKey: VARIANT,
      currentPresentationRevisionId: a.presentationRevisionId,
      currentPath: a.path,
      contentSha256: a.sha256,
      status: "active",
      assessmentRevisionId: R1,
      publishedBy: OPERATOR,
    });
    // Audit/attribution: publishedBy is present and equals the operator; the
    // durable historical record remains the append-only manifest.
    expect(rec?.publishedBy).toBe(OPERATOR);
  });
});

describe("failure safety - the index never advances on any pre-index failure (suite P)", () => {
  test("T-E4/verifier-gate: retention verifier failure -> no deploy, no fetch, no index", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    world.setVerifierOk(false);
    let deployed = false;
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        deployed = true;
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("LOCAL_VERIFIED");
    expect(deployed).toBe(false);
    expect(world.events).toEqual(["load"]);
    expect(world.index.size).toBe(0);
  });

  test("unknown/unretained revision -> LOCAL failure, no index", async () => {
    const world = makeWorld();
    world.retain(LESSON, VARIANT, "<html>A</html>");
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: `pr${"9".repeat(64)}` }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("LOCAL_VERIFIED");
    expect(world.index.size).toBe(0);
  });

  test("T-P1: deploy failure -> index unchanged (stays on prior revision)", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    // Publish A successfully first so a prior pointer exists.
    await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });
    // F5.3 Slice 9C-2: B covers a synthetic deployed r2, so its publication is
    // a genuine create (publishing over A's own revision is refused earlier).
    world.deployed.add(`assessment_${LESSON}__r2`);
    const b = world.retain(LESSON, VARIANT, "<html>B</html>", `assessment_${LESSON}__r2`);

    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: false, error: "hosting deploy timed out" }),
      fetchHosted: makeHostedFetch(world),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedStage).toBe("HOSTING_DEPLOYED");
      expect(result.indexAdvanced).toBe(false);
    }
    // r1 coverage still points at A; no r2 coverage was written.
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      a.presentationRevisionId,
    );
    expect(world.index.has(world.docId(LESSON, VARIANT, 2))).toBe(false);
  });

  test("fetch/network failure -> no index", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: () => Promise.resolve({ ok: false, error: "ECONNREFUSED" }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    expect(world.index.size).toBe(0);
  });

  test("HTTP 404 (artifact not actually deployed) -> no index", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    // Deploy port claims success but does NOT publish to the hosted tree, so
    // the liveness fetch 404s - exactly the "index-never-precedes-liveness"
    // guard.
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    expect(world.index.size).toBe(0);
  });

  test("SPA/fallback shell bytes (200 but wrong content) -> no index", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const spaFetch: FetchHostedPort = () => Promise.resolve({
      ok: true,
      status: 200,
      redirected: false,
      bytes: "<!doctype html><title>LyfeLabz app shell</title>",
    });
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: spaFetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    expect(world.index.size).toBe(0);
  });

  test("stale/truncated bytes (hash mismatch) -> no index", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A full</html>");
    const truncated: FetchHostedPort = () => Promise.resolve({
      ok: true,
      status: 200,
      redirected: false,
      bytes: "<html>A fu",
    });
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: truncated,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    expect(world.index.size).toBe(0);
  });

  test("redirect to unrelated content is not accepted as proof -> no index", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const redirected: FetchHostedPort = () => Promise.resolve({
      ok: true,
      status: 302,
      redirected: true,
      bytes: "",
    });
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: redirected,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    expect(world.index.size).toBe(0);
  });

  test("T-P3: liveness verifying the WRONG revision's bytes cannot advance the index", async () => {
    // Deploy A but ask to publish B: the liveness fetch of B's path returns
    // A's bytes (or 404), so B can never become current.
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    world.deployToHosted();
    const b = world.retain(LESSON, VARIANT, "<html>B</html>"); // committed but NOT deployed
    void a;
    const result = await publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }), // claims success, B not hosted
      fetchHosted: makeHostedFetch(world),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    expect(world.index.has(world.docId(LESSON, VARIANT))).toBe(false);
  });

  test("T-P2: liveness passes but index write throws -> old index remains; retry succeeds alone", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    world.deployToHosted();
    let attempts = 0;
    const flaky: WriteScopedCoveragePort = async (args) => {
      attempts += 1;
      if (attempts === 1) throw new Error("firestore unavailable");
      return world.ports.writeScopedCoverage(args);
    };

    const first = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
      writeScopedCoverage: flaky,
    });
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.failedStage).toBe("INDEX_UPDATED");
      expect(first.indexAdvanced).toBe(false);
    }
    expect(world.index.size).toBe(0); // old index unchanged (absent here)

    // Retry the whole publish (idempotent; artifact already retained/hosted).
    const retry = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
      writeScopedCoverage: flaky,
    });
    expect(retry.ok).toBe(true);
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      a.presentationRevisionId,
    );
  });

  test("empty publishedBy is rejected before any side effect", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const result = await publishRetainedRevision(
      baseInput({ presentationRevisionId: a.presentationRevisionId, publishedBy: "   " }),
      {
        ...world.ports,
        deployHosting: () => {
          world.events.push("deploy");
          return Promise.resolve({ ok: true });
        },
        fetchHosted: makeHostedFetch(world),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failedStage).toBe("INPUT");
    expect(world.events).toEqual([]);
  });
});

describe("retry after publication failure does not rewrite history", () => {
  test("a retained revision can be retried; the manifest/tree are not duplicated or rewritten", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const manifestLenBefore = world.manifest.length;
    const bytesBefore = world.tree.get(a.path);

    // First attempt fails at deploy.
    await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: false, error: "transient" }),
      fetchHosted: makeHostedFetch(world),
    });

    // Retry succeeds. The machine touches neither the manifest nor the tree.
    const retry = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });

    expect(retry.ok).toBe(true);
    expect(world.manifest.length).toBe(manifestLenBefore);
    expect(world.tree.get(a.path)).toBe(bytesBefore);
  });
});

const deployAll = (world: ReturnType<typeof makeWorld>) => () => {
  world.deployToHosted();
  return Promise.resolve({ ok: true as const });
};

// F5.3 Slice 9C-2 owner ruling: publish is create-only; the explicit rollback
// is the only repoint (and re-activation) of an existing scoped record.
describe("T-E2 (index half): regenerate A -> B; publish never overwrites, rollback repoints", () => {
  test("publishing B over current A is refused before any side effect; rollback repoints to B; A stays retained", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const aBytes = world.tree.get(a.path);
    await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: deployAll(world),
      fetchHosted: makeHostedFetch(world),
    });
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(a.presentationRevisionId);

    const b = world.retain(LESSON, VARIANT, "<html>B</html>");
    let deploys = 0;
    const pubB = await publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        deploys += 1;
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });
    expect(pubB.ok).toBe(false);
    if (!pubB.ok) {
      expect(pubB.failedStage).toBe("LOCAL_VERIFIED");
      expect(pubB.error).toContain("publish never overwrites it - use --op=rollback");
    }
    expect(deploys).toBe(0);
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(a.presentationRevisionId);

    world.deployToHosted();
    const rollB = await publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId, mode: "rollback" }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
    });
    expect(rollB.ok).toBe(true);
    if (rollB.ok) expect(rollB.coverage).toEqual({ docId: world.docId(LESSON, VARIANT), action: "repoint" });
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(b.presentationRevisionId);
    expect(world.tree.get(a.path)).toBe(aBytes);
    expect(world.manifest.find((e) => e.path === a.path)).toBeDefined();
  });

  test("re-publishing the identical current revision reconciles with no rewrite", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const run = () =>
      publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
        ...world.ports,
        deployHosting: deployAll(world),
        fetchHosted: makeHostedFetch(world),
      });
    const first = await run();
    const before = world.index.get(world.docId(LESSON, VARIANT));
    const second = await run();
    expect(first.ok && first.coverage.action).toBe("create");
    expect(second.ok && second.coverage.action).toBe("reconcile");
    expect(world.index.get(world.docId(LESSON, VARIANT))).toBe(before);
  });
});

describe("rollback / repoint (T-P4)", () => {
  test("rollback to a retained prior revision re-verifies liveness, repoints the scoped record, deletes nothing", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const b = world.retain(LESSON, VARIANT, "<html>B</html>");
    await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: deployAll(world),
      fetchHosted: makeHostedFetch(world),
    });
    await publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId, mode: "rollback" }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
    });
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(b.presentationRevisionId);

    let deployCalls = 0;
    const rollback = await publishRetainedRevision(
      baseInput({ presentationRevisionId: a.presentationRevisionId, mode: "rollback" }),
      {
        ...world.ports,
        deployHosting: () => {
          deployCalls += 1;
          return Promise.resolve({ ok: true });
        },
        fetchHosted: makeHostedFetch(world),
      },
    );
    expect(rollback.ok).toBe(true);
    expect(deployCalls).toBe(0);
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(a.presentationRevisionId);
    expect(world.tree.get(b.path)).toBe("<html>B</html>");
  });

  test("rollback to a prior revision whose hosted bytes are NOT live is refused (no repoint)", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const b = world.retain(LESSON, VARIANT, "<html>B</html>");
    world.hosted.set(b.path, "<html>B</html>");
    await publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
    });
    const rollback = await publishRetainedRevision(
      baseInput({ presentationRevisionId: a.presentationRevisionId, mode: "rollback" }),
      {
        ...world.ports,
        deployHosting: () => Promise.resolve({ ok: true }),
        fetchHosted: makeHostedFetch(world),
      },
    );
    expect(rollback.ok).toBe(false);
    if (!rollback.ok) expect(rollback.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(b.presentationRevisionId);
  });

  test("rollback re-activates a retired scoped record; publish does not", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    world.deployToHosted();
    world.index.set(world.docId(LESSON, VARIANT), {
      lessonSlug: LESSON, variantKey: VARIANT, currentPresentationRevisionId: a.presentationRevisionId, currentPath: a.path,
      contentSha256: a.sha256, status: "retired", assessmentRevisionId: R1, publishedBy: OPERATOR,
    });
    const deps = { ...world.ports, deployHosting: () => Promise.resolve({ ok: true as const }), fetchHosted: makeHostedFetch(world) };
    const pub = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), deps);
    expect(pub.ok).toBe(false);
    expect(world.index.get(world.docId(LESSON, VARIANT))?.status).toBe("retired");
    const roll = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId, mode: "rollback" }), deps);
    expect(roll.ok && roll.coverage.action).toBe("repoint");
    expect(world.index.get(world.docId(LESSON, VARIANT))?.status).toBe("active");
  });
});

describe("concurrent publication (create-only: exactly one valid revision wins, no invalid one can)", () => {
  test("two valid verified revisions race; exactly one creates the scoped record; the other is refused", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const b = world.retain(LESSON, VARIANT, "<html>B</html>");
    world.deployToHosted();
    const deps = { ...world.ports, deployHosting: () => Promise.resolve({ ok: true as const }), fetchHosted: makeHostedFetch(world) };
    const [ra, rb] = await Promise.all([
      publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), deps),
      publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId }), deps),
    ]);
    const winners = [ra, rb].filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    const loser = [ra, rb].find((r) => !r.ok);
    if (loser && !loser.ok) expect(loser.failedStage).toBe("INDEX_UPDATED");
    const current = world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId;
    expect(winners[0].ok && winners[0].revision.presentationRevisionId).toBe(current);
  });

  test("a concurrent UNVERIFIED revision (not hosted) never becomes current", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const bad = world.retain(LESSON, VARIANT, "<html>BAD</html>");
    world.hosted.set(a.path, "<html>A</html>");
    const deps = { ...world.ports, deployHosting: () => Promise.resolve({ ok: true as const }), fetchHosted: makeHostedFetch(world) };
    const [ra, rbad] = await Promise.all([
      publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), deps),
      publishRetainedRevision(baseInput({ presentationRevisionId: bad.presentationRevisionId }), deps),
    ]);
    expect(ra.ok).toBe(true);
    expect(rbad.ok).toBe(false);
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(a.presentationRevisionId);
  });
});

describe("retirement (withdraws eligibility of one revision's scoped coverage; retains history)", () => {
  function makeRetireWorld() {
    const world = makeWorld();
    const readScopedCoverage = world.ports.readScopedCoverage;
    const writeScopedRetire = ({ key, publishedBy }: { key: { docId: string }; publishedBy: string }) => {
      const rec = world.index.get(key.docId);
      if (rec) world.index.set(key.docId, { ...rec, status: "retired", publishedBy });
      return Promise.resolve();
    };
    return { world, readScopedCoverage, writeScopedRetire };
  }
  const retireInput = (overrides: Record<string, string> = {}) => ({
    lessonSlug: LESSON,
    variantKey: VARIANT,
    assessmentRevisionId: R1,
    publishedBy: OPERATOR,
    ...overrides,
  });

  test("retiring an active scoped record flips status; artifact + manifest untouched", async () => {
    const { world, readScopedCoverage, writeScopedRetire } = makeRetireWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: deployAll(world),
      fetchHosted: makeHostedFetch(world),
    });
    const result = await retireVariant(retireInput(), { readScopedCoverage, writeScopedRetire });
    expect(result).toEqual({ ok: true, retired: true, note: "retired" });
    expect(world.index.get(world.docId(LESSON, VARIANT))?.status).toBe("retired");
    expect(world.tree.get(a.path)).toBe("<html>A</html>");
    expect(world.manifest.find((e) => e.path === a.path)).toBeDefined();
  });

  test("retiring when no scoped record exists is a safe no-op", async () => {
    const { world, readScopedCoverage, writeScopedRetire } = makeRetireWorld();
    const result = await retireVariant(retireInput(), { readScopedCoverage, writeScopedRetire });
    expect(result).toEqual({ ok: true, retired: false, note: "no scoped coverage; nothing to retire" });
    expect(world.index.size).toBe(0);
  });

  test("retiring an already-retired scoped record is idempotent", async () => {
    const { world, readScopedCoverage, writeScopedRetire } = makeRetireWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    world.index.set(world.docId(LESSON, VARIANT), {
      lessonSlug: LESSON, variantKey: VARIANT, currentPresentationRevisionId: a.presentationRevisionId, currentPath: a.path,
      contentSha256: a.sha256, status: "retired", assessmentRevisionId: R1, publishedBy: OPERATOR,
    });
    const result = await retireVariant(retireInput(), { readScopedCoverage, writeScopedRetire });
    expect(result).toEqual({ ok: true, retired: false, note: "already retired" });
  });

  test("retirement requires attribution and a revision of this lesson, and refuses a record of another identity", async () => {
    const { world, readScopedCoverage, writeScopedRetire } = makeRetireWorld();
    expect((await retireVariant(retireInput({ publishedBy: "" }), { readScopedCoverage, writeScopedRetire })).ok).toBe(false);
    for (const bad of ["assessment_water-cycle__r1", `assessment_${LESSON}__r0`, "r1"]) {
      expect((await retireVariant(retireInput({ assessmentRevisionId: bad }), { readScopedCoverage, writeScopedRetire })).ok).toBe(false);
    }
    world.index.set(world.docId(LESSON, VARIANT), {
      lessonSlug: LESSON, variantKey: VARIANT, currentPresentationRevisionId: "x", currentPath: "x",
      contentSha256: "x", status: "active", assessmentRevisionId: `assessment_${LESSON}__r2`, publishedBy: OPERATOR,
    });
    const refused = await retireVariant(retireInput(), { readScopedCoverage, writeScopedRetire });
    expect(refused.ok).toBe(false);
    expect(world.index.get(world.docId(LESSON, VARIANT))?.status).toBe("active");
  });
});
