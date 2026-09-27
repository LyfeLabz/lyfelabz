import * as crypto from "crypto";

import * as path from "path";

import { canonicalJson } from "../shared/types/assessment-presentation";
import { makeLoadRetainedRevision } from "./publish-variant";
import {
  publishRetainedRevision,
  reconcileAssessmentBinding,
  type PublishDeps,
  type PublishInput,
  type RetainedRevision,
} from "../variants/variant-publication";

// F5.3 Slice 5 - publication of a revision bound to an assessment
// presentation (replaces the Slice 3 refusal). Every side effect is a fake;
// the record is synthetic with its real content-addressed id.

const LESSON = "synthetic-lesson";
const VARIANT = "reading-adapted";
const REVISION_ID = `assessment_${LESSON}__r1`;

const hashBytes = (bytes: string | Buffer | Uint8Array): string =>
  crypto.createHash("sha256").update(bytes as crypto.BinaryLike).digest("hex");

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "lyfelabz.assessmentPresentation",
    lessonSlug: LESSON,
    assessmentRevisionId: REVISION_ID,
    traits: { language: "adapted", choiceCount: 3 },
    directions: null,
    items: [
      { itemId: "q1", stem: "Q1?", displayedOptions: [{ optionId: "C", text: "c" }, { optionId: "A", text: "a" }, { optionId: "D", text: "d" }], omittedOptions: [{ optionId: "B", rationale: "r" }], feedback: null },
      { itemId: "q2", stem: "Q2?", displayedOptions: [{ optionId: "A", text: "a" }, { optionId: "B", text: "b" }, { optionId: "D", text: "d" }], omittedOptions: [{ optionId: "C", rationale: "r" }], feedback: null },
    ],
    showYourThinking: { prompt: "Explain convection.", modelAnswer: "m", requiredTerms: ["convection"] },
    ...overrides,
  };
}
const apIdOf = (r: unknown): string => `ap${hashBytes(canonicalJson(r))}`;

const ARTIFACT = "<html>synthetic bound artifact</html>";
const SHA = hashBytes(ARTIFACT);
const PR = `pr${SHA}`;
const PATH = `app/lessons/variants/lesson_${LESSON}__${PR}.html`;

function revision(binding: "bound" | "unbound" = "bound", rec = record()): RetainedRevision {
  return {
    lessonSlug: LESSON,
    variantKey: VARIANT,
    presentationRevisionId: PR,
    path: PATH,
    sha256: SHA,
    ...(binding === "bound"
      ? { assessmentBinding: { assessmentRevisionId: REVISION_ID, assessmentPresentationRevisionId: apIdOf(rec), record: rec } }
      : {}),
  };
}

function harness(rev: RetainedRevision, overrides: Partial<PublishDeps> = {}) {
  const calls: string[] = [];
  const ensured: Array<{ apId: string; record: unknown }> = [];
  const indexWrites: RetainedRevision[] = [];
  const deps: PublishDeps = {
    loadRetainedRevision: () => Promise.resolve({ ok: true, revision: rev }),
    deployHosting: () => {
      calls.push("deploy");
      return Promise.resolve({ ok: true });
    },
    fetchHosted: () => {
      calls.push("fetch");
      return Promise.resolve({ ok: true, status: 200, redirected: false, bytes: Buffer.from(ARTIFACT) });
    },
    hashBytes,
    readDeployedAssessmentRevision: () => {
      calls.push("readDeployed");
      return Promise.resolve(REVISION_ID);
    },
    ensureAssessmentPresentation: (apId, rec) => {
      calls.push("ensure");
      ensured.push({ apId, record: rec });
      return Promise.resolve({ ok: true, created: true });
    },
    writeIndexActivate: (r) => {
      calls.push("index");
      indexWrites.push(r);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, calls, ensured, indexWrites };
}

const INPUT: PublishInput = { lessonSlug: LESSON, variantKey: VARIANT, presentationRevisionId: PR, mode: "publish", publishedBy: "operator" };

describe("publishing a revision bound to an assessment presentation", () => {
  it("records the presentation after live bytes are proven and before the index, then pins the binding", async () => {
    const h = harness(revision());
    const result = await publishRetainedRevision(INPUT, h.deps);
    expect(result.ok).toBe(true);
    expect(result.stagesCompleted).toEqual([
      "LOCAL_VERIFIED",
      "HOSTING_DEPLOYED",
      "HOSTED_BYTES_VERIFIED",
      "ASSESSMENT_PRESENTATION_RECORDED",
      "INDEX_UPDATED",
    ]);
    expect(h.calls).toEqual(["readDeployed", "deploy", "fetch", "ensure", "index"]);
    expect(h.ensured).toEqual([{ apId: apIdOf(record()), record: record() }]);
    expect(h.indexWrites[0].assessmentBinding).toMatchObject({
      assessmentRevisionId: REVISION_ID,
      assessmentPresentationRevisionId: apIdOf(record()),
    });
  });

  it("is idempotent when the identical record already exists", async () => {
    const h = harness(revision(), {
      ensureAssessmentPresentation: () => Promise.resolve({ ok: true, created: false }),
    });
    expect((await publishRetainedRevision(INPUT, h.deps)).ok).toBe(true);
  });

  it("rolls back to a bound revision without redeploying Hosting", async () => {
    const h = harness(revision());
    const result = await publishRetainedRevision({ ...INPUT, mode: "rollback" }, h.deps);
    expect(result.ok).toBe(true);
    expect(h.calls).toEqual(["readDeployed", "fetch", "ensure", "index"]);
  });

  it("keeps legacy instruction-only publication unchanged (no presentation stage, no binding)", async () => {
    const h = harness(revision("unbound"), {
      readDeployedAssessmentRevision: undefined,
      ensureAssessmentPresentation: undefined,
    });
    const result = await publishRetainedRevision(INPUT, h.deps);
    expect(result.ok).toBe(true);
    expect(result.stagesCompleted).toEqual(["LOCAL_VERIFIED", "HOSTING_DEPLOYED", "HOSTED_BYTES_VERIFIED", "INDEX_UPDATED"]);
    expect(h.indexWrites[0].assessmentBinding).toBeUndefined();
  });

  it.each([
    ["the presentation ports are missing", () => harness(revision(), { ensureAssessmentPresentation: undefined }), "needs the assessment-presentation publication ports"],
    ["the record content does not match its id (bad hash)", () => {
      const rev = revision();
      const tampered = { ...rev, assessmentBinding: { ...rev.assessmentBinding!, record: record({ directions: "tampered" }) } };
      return harness(tampered);
    }, "hashes to"],
    ["the record belongs to another lesson", () => {
      const rec = record({ lessonSlug: "other-lesson" });
      return harness(revision("bound", rec));
    }, 'belongs to lesson "other-lesson"'],
    ["the record maps to another assessment revision", () => {
      const rec = record({ assessmentRevisionId: `assessment_${LESSON}__r2` });
      return harness(revision("bound", rec));
    }, `maps to assessment_${LESSON}__r2, not ${REVISION_ID}`],
    ["the bound revision is not the deployed current revision", () =>
      harness(revision(), { readDeployedAssessmentRevision: () => Promise.resolve(`assessment_${LESSON}__r2`) }),
    "is not the deployed current revision"],
    ["the lesson has no deployed assessment", () =>
      harness(revision(), { readDeployedAssessmentRevision: () => Promise.resolve(null) }),
    "is not the deployed current revision (null)"],
  ])("refuses at LOCAL_VERIFIED, before any side effect, when %s", async (_label, make, message) => {
    const h = make();
    const result = await publishRetainedRevision(INPUT, h.deps);
    expect(result).toMatchObject({ ok: false, failedStage: "LOCAL_VERIFIED", indexAdvanced: false });
    expect((result as { error: string }).error).toContain(message);
    expect(h.calls.filter((c) => c !== "readDeployed")).toEqual([]);
  });

  it("refuses a malformed binding shape at the self-consistency check", async () => {
    const rev = revision();
    const bad = { ...rev, assessmentBinding: { ...rev.assessmentBinding!, assessmentRevisionId: "assessment_other__r1" } };
    const h = harness(bad);
    const result = await publishRetainedRevision(INPUT, h.deps);
    expect(result).toMatchObject({ ok: false, failedStage: "LOCAL_VERIFIED" });
    expect(h.calls).toEqual([]);
  });

  it("never advances the index when the record cannot be written or differs", async () => {
    const h = harness(revision(), {
      ensureAssessmentPresentation: () => Promise.resolve({ ok: false, error: "already exists with different content" }),
    });
    const result = await publishRetainedRevision(INPUT, h.deps);
    expect(result).toMatchObject({ ok: false, failedStage: "ASSESSMENT_PRESENTATION_RECORDED", indexAdvanced: false });
    expect(h.indexWrites).toHaveLength(0);
  });

  it("never advances the index when recording throws", async () => {
    const h = harness(revision(), {
      ensureAssessmentPresentation: () => Promise.reject(new Error("firestore unavailable")),
    });
    const result = await publishRetainedRevision(INPUT, h.deps);
    expect(result).toMatchObject({ ok: false, failedStage: "ASSESSMENT_PRESENTATION_RECORDED" });
    expect(h.indexWrites).toHaveLength(0);
  });
});

describe("reconcileAssessmentBinding (manifest vs artifact vs certified record)", () => {
  const rec = record();
  const apId = apIdOf(rec);
  const entry = { lessonSlug: LESSON, assessmentRevisionId: REVISION_ID, assessmentPresentationRevisionId: apId };
  const block = {
    schemaVersion: 1,
    lessonSlug: LESSON,
    assessmentRevisionId: REVISION_ID,
    assessmentPresentationRevisionId: apId,
    items: [
      { itemId: "q1", optionIds: ["C", "A", "D"] },
      { itemId: "q2", optionIds: ["A", "B", "D"] },
    ],
  };
  const certified = { record: rec, failures: [] as string[] };

  it("accepts a certified record whose artifact embeds exactly its binding", () => {
    const r = reconcileAssessmentBinding({ entry, artifactBindingBlock: block, certification: certified });
    expect(r).toMatchObject({ ok: true, binding: { assessmentPresentationRevisionId: apId, assessmentRevisionId: REVISION_ID } });
  });

  it("accepts a legacy unbound entry whose artifact carries no binding", () => {
    expect(reconcileAssessmentBinding({ entry: { lessonSlug: LESSON }, artifactBindingBlock: null, certification: null })).toEqual({ ok: true });
  });

  it.each([
    ["an unbound entry whose artifact carries a binding", { entry: { lessonSlug: LESSON }, artifactBindingBlock: {}, certification: null }, "manifest entry is unbound"],
    ["half a binding", { entry: { lessonSlug: LESSON, assessmentPresentationRevisionId: apId }, artifactBindingBlock: block, certification: certified }, "half an assessment-presentation binding"],
    ["a missing record", { entry, artifactBindingBlock: block, certification: { record: null, failures: [`bound assessment presentation ${apId} is not retained`] } }, "is not retained"],
    ["an unapproved certification", { entry, artifactBindingBlock: block, certification: { record: rec, failures: [`bound presentation ${apId} is not approved`] } }, "is not approved"],
    ["a bad record hash", { entry, artifactBindingBlock: block, certification: { record: rec, failures: ["content hashes to apX, not apY"] } }, "content hashes to"],
    ["an artifact without its binding block", { entry, artifactBindingBlock: null, certification: certified }, "does not match"],
    ["an artifact whose displayed options differ", { entry, artifactBindingBlock: { ...block, items: [{ itemId: "q1", optionIds: ["A", "B", "D"] }, block.items[1]] }, certification: certified }, "does not match"],
    ["an artifact naming another presentation", { entry, artifactBindingBlock: { ...block, assessmentPresentationRevisionId: `ap${"0".repeat(64)}` }, certification: certified }, "does not match"],
    ["an artifact naming another assessment revision", { entry, artifactBindingBlock: { ...block, assessmentRevisionId: `assessment_${LESSON}__r2` }, certification: certified }, "does not match"],
  ])("refuses %s", (_label, args, message) => {
    const r = reconcileAssessmentBinding(args);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain(message);
  });
});

describe("real retained-revision loader", () => {
  it("still loads the historical unbound Earth's Layers revision with no binding (F5.2 meaning)", async () => {
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
    const load = makeLoadRetainedRevision(repoRoot);
    const result = await load({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      presentationRevisionId: "prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c",
    });
    expect(result.ok).toBe(true);
    const rev = (result as { revision: RetainedRevision }).revision;
    expect(rev.sha256).toBe("ff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c");
    expect(rev.assessmentBinding).toBeUndefined();
  });
});
