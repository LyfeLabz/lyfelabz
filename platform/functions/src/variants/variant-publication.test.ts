import * as crypto from "crypto";

import {
  publishRetainedRevision,
  retireVariant,
  type FetchHostedPort,
  type PublishInput,
  type RetainedRevision,
} from "./variant-publication";

// F5.2 §6.8 publication state machine (Slice 3). These tests exercise the
// pure machine with in-memory fakes for every port - no Hosting, no
// Firestore, no network. They prove the index-last ordering and fail-closed
// behavior (suite P, T-E2/E4-index, ordering/failure-safety/retry/rollback/
// retirement/concurrency per the Slice 3 test contract).

const LESSON = "earths-layers";
const VARIANT = "reading-adapted";
const OPERATOR = "operator-uid";

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
};

type IndexRecord = {
  lessonSlug: string;
  variantKey: string;
  currentPresentationRevisionId: string;
  currentPath: string;
  contentSha256: string;
  status: "active" | "retired";
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
  let verifierOk = true;

  function docId(lessonSlug: string, variantKey: string): string {
    return `${lessonSlug}__${variantKey}`;
  }

  // Simulates the Slice 2 add-only build: retain immutable bytes + append the
  // manifest entry. Idempotent for identical bytes; never rewrites history.
  function retain(lessonSlug: string, variantKey: string, bytes: string): ManifestEntry {
    const digest = sha256(bytes);
    const id = `pr${digest}`;
    const p = `app/lessons/variants/lesson_${lessonSlug}__${id}.html`;
    tree.set(p, bytes);
    if (!manifest.find((e) => e.path === p)) {
      manifest.push({ lessonSlug, variantKey, presentationRevisionId: id, path: p, sha256: digest });
    }
    return { lessonSlug, variantKey, presentationRevisionId: id, path: p, sha256: digest };
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
    return Promise.resolve({ ok: true as const, revision: { ...m } satisfies RetainedRevision });
  };

  const writeIndexActivate = (revision: RetainedRevision, publishedBy: string) => {
    events.push("write");
    index.set(docId(revision.lessonSlug, revision.variantKey), {
      lessonSlug: revision.lessonSlug,
      variantKey: revision.variantKey,
      currentPresentationRevisionId: revision.presentationRevisionId,
      currentPath: revision.path,
      contentSha256: revision.sha256,
      status: "active",
      publishedBy,
    });
    return Promise.resolve();
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
    ports: {
      loadRetainedRevision,
      writeIndexActivate,
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
    const b = world.retain(LESSON, VARIANT, "<html>B</html>");

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
    // Index still points at A.
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      a.presentationRevisionId,
    );
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
    const flaky = async (revision: RetainedRevision, publishedBy: string) => {
      attempts += 1;
      if (attempts === 1) throw new Error("firestore unavailable");
      await world.ports.writeIndexActivate(revision, publishedBy);
    };

    const first = await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => Promise.resolve({ ok: true }),
      fetchHosted: makeHostedFetch(world),
      writeIndexActivate: flaky,
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
      writeIndexActivate: flaky,
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

describe("T-E2 (index half): regenerate A -> B, index points to B, A remains retained", () => {
  test("both revisions retained; index advances to B; A byte-identical", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const aBytes = world.tree.get(a.path);

    await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      a.presentationRevisionId,
    );

    const b = world.retain(LESSON, VARIANT, "<html>B</html>");
    const pubB = await publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });

    expect(pubB.ok).toBe(true);
    // Index now points to B.
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      b.presentationRevisionId,
    );
    // A remains retained, byte-identical, still manifest-listed.
    expect(world.tree.get(a.path)).toBe(aBytes);
    expect(world.manifest.find((e) => e.path === a.path)).toBeDefined();
    expect(world.manifest.find((e) => e.path === b.path)).toBeDefined();
  });
});

describe("rollback / repoint (T-P4)", () => {
  test("rollback to a retained prior revision re-verifies liveness, repoints index, deletes nothing", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const b = world.retain(LESSON, VARIANT, "<html>B</html>");

    // Publish A then B; index now on B; both live.
    for (const rev of [a, b]) {
      await publishRetainedRevision(baseInput({ presentationRevisionId: rev.presentationRevisionId }), {
        ...world.ports,
        deployHosting: () => {
          world.deployToHosted();
          return Promise.resolve({ ok: true });
        },
        fetchHosted: makeHostedFetch(world),
      });
    }
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      b.presentationRevisionId,
    );

    // Roll back to A. No new deploy occurs; liveness of A is re-verified.
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
    expect(deployCalls).toBe(0); // rollback does not redeploy
    // Index repointed to A; B still retained (both artifacts intact).
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      a.presentationRevisionId,
    );
    expect(world.tree.get(b.path)).toBe("<html>B</html>");
    expect(world.manifest.find((e) => e.path === b.path)).toBeDefined();
  });

  test("rollback to a prior revision whose hosted bytes are NOT live is refused (no repoint)", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const b = world.retain(LESSON, VARIANT, "<html>B</html>");
    // Only B is actually hosted; A was never deployed / was purged from host.
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
        fetchHosted: makeHostedFetch(world), // A not in hosted -> 404
      },
    );
    expect(rollback.ok).toBe(false);
    if (!rollback.ok) expect(rollback.failedStage).toBe("HOSTED_BYTES_VERIFIED");
    // Index remains on B.
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      b.presentationRevisionId,
    );
  });
});

describe("concurrent publication (P5.1 - no CAS; either valid revision may win, no invalid one can)", () => {
  test("two valid verified revisions race; final index is one of them; unverified never wins", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const b = world.retain(LESSON, VARIANT, "<html>B</html>");
    world.deployToHosted(); // both A and B are live

    const [ra, rb] = await Promise.all([
      publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
        ...world.ports,
        deployHosting: () => Promise.resolve({ ok: true }),
        fetchHosted: makeHostedFetch(world),
      }),
      publishRetainedRevision(baseInput({ presentationRevisionId: b.presentationRevisionId }), {
        ...world.ports,
        deployHosting: () => Promise.resolve({ ok: true }),
        fetchHosted: makeHostedFetch(world),
      }),
    ]);

    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
    const current = world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId;
    expect([a.presentationRevisionId, b.presentationRevisionId]).toContain(current);
  });

  test("a concurrent UNVERIFIED revision (not hosted) never becomes current even if it writes last-ish", async () => {
    const world = makeWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    const bad = world.retain(LESSON, VARIANT, "<html>BAD</html>");
    world.hosted.set(a.path, "<html>A</html>"); // only A hosted

    const [ra, rbad] = await Promise.all([
      publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
        ...world.ports,
        deployHosting: () => Promise.resolve({ ok: true }),
        fetchHosted: makeHostedFetch(world),
      }),
      publishRetainedRevision(baseInput({ presentationRevisionId: bad.presentationRevisionId }), {
        ...world.ports,
        deployHosting: () => Promise.resolve({ ok: true }),
        fetchHosted: makeHostedFetch(world), // bad not hosted -> 404
      }),
    ]);

    expect(ra.ok).toBe(true);
    expect(rbad.ok).toBe(false);
    expect(world.index.get(world.docId(LESSON, VARIANT))?.currentPresentationRevisionId).toBe(
      a.presentationRevisionId,
    );
  });
});

describe("retirement (withdraws eligibility; retains history)", () => {
  function makeRetireWorld() {
    const world = makeWorld();
    const readIndexStatus = ({ lessonSlug, variantKey }: { lessonSlug: string; variantKey: string }) => {
      const rec = world.index.get(world.docId(lessonSlug, variantKey));
      if (!rec) return Promise.resolve({ exists: false as const });
      return Promise.resolve({ exists: true as const, status: rec.status });
    };
    const writeIndexRetire = ({
      lessonSlug,
      variantKey,
      publishedBy,
    }: {
      lessonSlug: string;
      variantKey: string;
      publishedBy: string;
    }) => {
      const id = world.docId(lessonSlug, variantKey);
      const rec = world.index.get(id);
      if (rec) world.index.set(id, { ...rec, status: "retired", publishedBy });
      return Promise.resolve();
    };
    return { world, readIndexStatus, writeIndexRetire };
  }

  test("retiring an active variant flips status; artifact + manifest untouched", async () => {
    const { world, readIndexStatus, writeIndexRetire } = makeRetireWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    await publishRetainedRevision(baseInput({ presentationRevisionId: a.presentationRevisionId }), {
      ...world.ports,
      deployHosting: () => {
        world.deployToHosted();
        return Promise.resolve({ ok: true });
      },
      fetchHosted: makeHostedFetch(world),
    });

    const result = await retireVariant(
      { lessonSlug: LESSON, variantKey: VARIANT, publishedBy: OPERATOR },
      { readIndexStatus, writeIndexRetire },
    );
    expect(result).toEqual({ ok: true, retired: true, note: "retired" });
    expect(world.index.get(world.docId(LESSON, VARIANT))?.status).toBe("retired");
    // Artifact + manifest entry retained.
    expect(world.tree.get(a.path)).toBe("<html>A</html>");
    expect(world.manifest.find((e) => e.path === a.path)).toBeDefined();
  });

  test("retiring when no index doc exists is a safe no-op", async () => {
    const { world, readIndexStatus, writeIndexRetire } = makeRetireWorld();
    const result = await retireVariant(
      { lessonSlug: LESSON, variantKey: VARIANT, publishedBy: OPERATOR },
      { readIndexStatus, writeIndexRetire },
    );
    expect(result).toEqual({ ok: true, retired: false, note: "no current index; nothing to retire" });
    expect(world.index.size).toBe(0);
  });

  test("retiring an already-retired variant is idempotent", async () => {
    const { world, readIndexStatus, writeIndexRetire } = makeRetireWorld();
    const a = world.retain(LESSON, VARIANT, "<html>A</html>");
    world.index.set(world.docId(LESSON, VARIANT), {
      lessonSlug: LESSON,
      variantKey: VARIANT,
      currentPresentationRevisionId: a.presentationRevisionId,
      currentPath: a.path,
      contentSha256: a.sha256,
      status: "retired",
      publishedBy: OPERATOR,
    });
    const result = await retireVariant(
      { lessonSlug: LESSON, variantKey: VARIANT, publishedBy: OPERATOR },
      { readIndexStatus, writeIndexRetire },
    );
    expect(result).toEqual({ ok: true, retired: false, note: "already retired" });
  });

  test("retirement requires server-owned attribution", async () => {
    const { readIndexStatus, writeIndexRetire } = makeRetireWorld();
    const result = await retireVariant(
      { lessonSlug: LESSON, variantKey: VARIANT, publishedBy: "" },
      { readIndexStatus, writeIndexRetire },
    );
    expect(result.ok).toBe(false);
  });
});
